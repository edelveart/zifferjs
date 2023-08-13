import { parse as parseZiffers } from './parser/ziffersParser.ts';
import { parse as parseScala } from './parser/scalaParser.ts';
import { DEFAULT_OPTIONS, isScale, getScale } from './defaults.ts';
import { Base, Pitch, Chord, Rest, Event, Start, Options, NodeOptions} from './types.ts';
import {LRUCache} from 'lru-cache';

const zcache = new LRUCache({max: 1000, ttl: 1000 * 60 * 5});

export class Ziffers {
    values: Base[];
    evaluated: (Pitch|Chord|Rest)[];
    options: Options;
    index: number;
    redo: number;
    current: Event;

    constructor(input: string, options: NodeOptions = {}) {
        this.index = 0;
        // Merge options with default options. TODO: Ignore some common options like degrees?
        options = {...DEFAULT_OPTIONS, ...options};

        // Parse scala format if scale is not a scale name
        if(options.scale) {
            if(typeof options.scale === 'string') {
                 if(!isScale(options.scale)) {
                    options.scale = parseScala(options.scale) as number[];
                } else {
                    options.scaleName = options.scale;
                    options.scale = getScale(options.scale) as number[];
                }
            }
            options.parsedScale = options.scale as number[];
            delete options.scale;
        }
        
        if(options.redo !== undefined) {
            this.redo = options.redo;
        } else {
            this.redo = 1;
        }

        this.options = {nodeOptions: options};

        try {
           this.values = parseZiffers(input, this.options);
           this.evaluated = this.evaluate();
           this.current = new Start();
           this.current.nextEvent = this.evaluated[0];
        } catch (ex: any) {
            console.log(ex);
            // Handle parsing error
            // [...]
            this.values = [];
            this.evaluated = [];
            this.current = new Start();
        }
    }

    update() {
        this.evaluated = this.evaluate();
    }

    pitches(): (number|undefined|number[])[] {
        return this.evaluated.map((item: Pitch|Chord|Rest) => {
            return item.collect("pitch");
        })
    }

    notes(): (number|undefined|number[])[] {
        return this.evaluated.map((item: Pitch|Chord|Rest) => {
            return item.collect("note");
        });  
    }

    freqs(): (number|undefined|number[])[] {
        return this.evaluated.map((item: Pitch|Chord|Rest) => {
            return item.collect("freq");
        });
    }

    durations(): (number|undefined|number[])[] {
        return this.evaluated.map((item: Pitch|Chord|Rest) => {
            return item.collect("duration");
        });
    }
            
    next() {
        /*const value = this.evaluated[this.index%this.evaluated.length];
        this.index++;
         if(this.redo > 0 && this.index >= this.evaluated.length*this.redo) {
            this.index = 0;
            this.update();
        }*/
        this.index++;
        const nextEvent = this.current;
        this.current = this.current.nextEvent;
        return nextEvent;
    }

    peek() {
        return this.current;
    }

    evaluate(): (Pitch|Chord|Rest)[] {
        const items = this.values.map((node: Base) => {
            return node.evaluate();
        }).flat(Infinity).filter((node) => node !== undefined) as (Pitch|Chord|Rest)[];
        items.forEach((item: Event, index) => {
            item.nextEvent = index < items.length-1 ? items[index+1] : items[0];
            item.prevEvent = index > 0 ? items[index-1] : items[items.length-1];
        });
        return items;
    }

}

const generateCacheKey = (...args: any[]) => {
    return args.map(arg => JSON.stringify(arg)).join(',');
  }

const cachedCall = (a: string, b: NodeOptions): Ziffers => {
    const cacheKey = generateCacheKey(a, b);
    if (zcache.has(cacheKey)) {
        const cached = zcache.get(cacheKey) as Ziffers;
        return cached;
    } else {
        const result = new Ziffers(a, b);
        zcache.set(cacheKey, result);
        return result;
    }
}

export const pattern = (input: string, options: object = {}) => {
    return new Ziffers(input, options);
}

export const cache = (input: string, options: NodeOptions = {}) => {
    return cachedCall(input, options);
}

export const cachedStart = (input: string, options: NodeOptions = {}) => {
    const fromCache = cachedCall(input, options);
    return fromCache.next();
}

export const cachedIterator = (input: string, options: NodeOptions = {}) => {
    const fromCache = cachedCall(input, options).next();
    return fromCache.next();
}

export const get = (input: string, options: NodeOptions = {}): Pitch|Chord|Rest => {   
    if(options.index) {
        let index = options.index;
        delete options.index;
        let fromCache = cachedCall(input, options);
        index = index%fromCache.evaluated.length;
        fromCache.index = index+1;
        return fromCache.evaluated[index];
    }
    const fromCache = cachedCall(input, options);
    if(fromCache.current instanceof Start) fromCache.next();
    return fromCache.peek();
}

export const note = (input: string, options: NodeOptions = {}): number|undefined => {
    return cachedIterator(input, options).collect("note");
}

export const pitch = (input: string, options: NodeOptions = {}): number|undefined => {
    return cachedIterator(input, options).collect("pitch");
}

export const freq = (input: string, options: NodeOptions = {}): number|undefined => {
    return cachedIterator(input, options).collect("freq");
}

export const clear = (input: string, options: NodeOptions = {}): void => {
    const cacheKey = generateCacheKey(input, options);
    zcache.delete(cacheKey);
}
