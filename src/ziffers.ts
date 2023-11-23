import { parse as parseZiffers } from './parser/ziffersParser.ts';
import { parse as parseScala } from './parser/scalaParser.ts';
import { DEFAULT_OPTIONS, isScale, getScale } from './defaults.ts';
import { voiceLead } from './scale.ts';
import { Base, Pitch, Chord, Roman, Rest, Event, SoundEvent, Options, NodeOptions, GlobalOptions, globalOptionKeys, ChangingOptions, Subdivision } from './types.ts';
import { deepClone, seededRandom } from './utils.ts';
import { rsystem } from './rules.ts';
import { TonnetzSpaces, enneaCycles, explorativeSeventhsTransform, hexaCycles, octaCycles } from './tonnetz.ts';

type ZEvent = Pitch|Chord|Roman|Rest|SoundEvent;

export class Ziffers {
    input: string;
    generator?: Generator<number>;
    generatorDone?: boolean = false;
    values: Base[];
    evaluated: ZEvent[];
    options: Options;
    counter: number = 0;
    redo: number;
    index: number = -1;
    globalOptions : GlobalOptions;
    duration: number;

    constructor(input: string, options: NodeOptions = {}, globalOptions: GlobalOptions = {}) {
        this.input = input;
        // Merge options with default options. TODO: Ignore some common options like degrees?
        options = {...DEFAULT_OPTIONS, ...options};
        this.globalOptions = globalOptions;
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

        if(options && options.seed) {
            options.randomSeed = options.seed;
            options.seededRandom = seededRandom(options.seed);
        }

        // Check if globalOpions is empty
        if(Object.keys(globalOptions).length === 0) {
            this.globalOptions = getGlobalOption(options);
        }

        this.options = {nodeOptions: options};

        try {
            this.values = parseZiffers(input, this.options);
            this.evaluated = this.evaluate(this.values);
            this.applyTransformations();
            this.duration = this.totalDuration();
        } catch (ex: any) {
            console.log(ex);
            // Handle parsing error
            // [...]
            this.values = [];
            this.evaluated = [];
            this.duration = 0;
        }
    }

    static fromGenerator(generator: Generator<number>, options: NodeOptions = {}): Ziffers {
        const number = generator.next().value;
        const ziff = this.fromNumber(number, options);
        ziff.generator = generator;
        return ziff;
    }

    static fromNumber(num: number, options: NodeOptions = {}) {
        const input = this.inputFromNumber(num);
        return new Ziffers(input, options);
    }

    static inputFromNumber(num: number) {
        let input = num.toString();
        if(input.length>1) input = input.split("").join(" ");
        return input;
    }

    revaluate() {
        this.values = parseZiffers(this.input, this.options);
        this.evaluated = this.evaluate(this.values);
        this.applyTransformations();
        this.duration = this.totalDuration();
    }

    pitches(): (number|undefined|number[])[] {
        return this.evaluated.map((item: ZEvent) => {
            return item.collect("pitch");
        })
    }

    notes(): (number|undefined|number[])[] {
        return this.evaluated.map((item: ZEvent) => {
            return item.collect("note");
        });  
    }

    sounds(): string[] {
        return this.evaluated.map((item: ZEvent) => {
            return item.collect("sound");
        });  
    }

    indices(): number[] {
        return this.evaluated.map((item: ZEvent) => {
            return item.collect("soundIndex");
        });
    }

    freqs(): (number|undefined|number[])[] {
        return this.evaluated.map((item: ZEvent) => {
            return item.collect("freq");
        });
    }

    durations(): (number|undefined|number[])[] {
        return this.evaluated.map((item: ZEvent) => {
            return item.collect("duration");
        });
    }

    octaves(): (undefined|number|number[])[] {
        return this.evaluated.map((item: ZEvent) => {
            return item.collect("octave");
        });
    }

    retrograde(): Ziffers {
        this.evaluated = this.evaluated.reverse();
        return this;
    }

    scale(scale: string) {
        this.applyOptions({scale: scale});
        return this;
    }

    key(key: string) {
        this.applyOptions({key: key});
        return this;
    }

    octave(octave: number) {
        this.applyOptions({octave: octave});
        return this;
    }

    invert(invert: number) {
        this.applyOptions({inversion: invert});
        return this;
    }

    isInOptions(key: string, value: string|number) {
        return this.options.nodeOptions && this.options.nodeOptions[key as keyof NodeOptions] === value;
    }
            
    atLast(): boolean {
        return this.index+1 >= this.evaluated.length*this.redo;
    }

    clone(): Ziffers {
        return deepClone(this);
    }

    notStarted() {
        return this.index < 0
    }

    peek() {
        return this.evaluated[this.index-1 || 0];
    }

    hasStarted(): boolean {
        return this.index >= 0;
    }

    reset() {
        this.index = -1;
        this.counter = 0;
    }

    next(): Event {
        // Check for the first run
        if(this.index<0) this.index = 0;

        // Get next item
        const nextEvent = this.evaluated[this.index % this.evaluated.length];

        this.index++;
        this.counter++;

        // Check if next item is last
        if(this.redo > 0 && this.index >= this.evaluated.length * this.redo) {
            this.index = 0;
            if(this.generator) {
                const next = this.generator.next();
                if(next.done) {
                    this.generatorDone = true;
                } else {
                    this.input = Ziffers.inputFromNumber(next.value);
                    this.revaluate();
                }
            }
            this.evaluated = this.evaluate(this.values);
        }

        return nextEvent;
    }

    applyOptions(options: ChangingOptions = {}) {
        this.evaluated = this.evaluate(this.evaluated, options);
        this.applyTransformations();
    }

    applyTransformations() {
        // TODO: Make more generic
        if(this.globalOptions?.retrograde) {
            this.evaluated = this.evaluated.reverse();
        }
    }

    update() {
        this.evaluated = this.evaluate(this.values);
        this.applyTransformations();
        return this;
    }

    evaluate(values: Base[], options: ChangingOptions = {}): ZEvent[] {
        let items = values.map((node: Base) => {
            return node.evaluate(options);
        }).flat(Infinity).filter((node) => node !== undefined) as (ZEvent|Subdivision)[];
        if(options.subdivisions) {
            items = resolveSubdivisions(items);
         }
        return items as ZEvent[];
    }

    totalDuration(): number {
        const length = this.evaluated.reduce((acc: number, item: ZEvent) => {
            return acc + item.collect("duration");
        }, 0);
        return length;
    }

    lead(): Ziffers {
        // Get first chord from evaluated events
        let lastChordIndex = this.evaluated.findIndex((o)=>{return o instanceof Chord});
        if(lastChordIndex>=0) {
            for(let i = lastChordIndex+1; i<=this.evaluated.length; i++) {
                if(this.evaluated[i] instanceof Chord) {
                    const aChord = (this.evaluated[lastChordIndex] as Chord);
                    const bChord = (this.evaluated[i] as Chord);
                    const leadedChord = voiceLead(aChord.notes(),bChord.notes());
                    const newChord = deepClone(bChord);
                    newChord.voiceLeadFromNotes(leadedChord, this.options.nodeOptions!);
                    this.evaluated[i] = newChord;
                    lastChordIndex = i;
                }
            }
        }
        return this;
    }

    toString(): string {
        return this.evaluated.map((item: ZEvent) => {
            return item.toString();
        }).join(" ");
    }

    rules(rules: Record<string|number, string | number | ((...args: any[]) => string|number)>, gen: number = 1): Ziffers {
        const replacedString = rsystem(this.input, rules, gen);
        return new Ziffers(replacedString, this.options.nodeOptions!, this.globalOptions);
    }

    tonnetzChords(chordType: string, tonnetz: TonnetzSpaces = [3,4,5]): Ziffers {
        if(this.evaluated) {
            this.evaluated = this.evaluated.map((item: ZEvent) => {
                if(item instanceof Pitch) {
                    return item.tonnetzChord(chordType, tonnetz);
                } else return item;
            });
        }
        return this;
    }

    tonnetz(transformation: string, tonnetz: TonnetzSpaces = [3,4,5]): Ziffers {
        if(this.evaluated) {
            this.evaluated = this.evaluated.map((item: ZEvent) => {
                if(item instanceof Chord) {
                    if(item.notes().length===3) {
                        return item.triadTonnetz(transformation, tonnetz);
                    } else if(item.notes().length===4) {
                        return item.tetraTonnetz(transformation, tonnetz, explorativeSeventhsTransform);
                    }
                } else return item;
            }).flat(Infinity) as ZEvent[];
        }
        return this;
    }

    triadTonnetz(transformation: string, tonnetz: TonnetzSpaces = [3,4,5]): Ziffers {
        if(this.evaluated) {
            this.evaluated = this.evaluated.map((item: ZEvent) => {
                if(item instanceof Chord) {
                    return item.triadTonnetz(transformation, tonnetz);
                } else return item;
            }).flat(Infinity) as ZEvent[];
        }
        return this;
    }

    tetraTonnetz(transformation: string, tonnetz: TonnetzSpaces = [3,4,5]): Ziffers {
        if(this.evaluated) {
            this.evaluated = this.evaluated.map((item: ZEvent) => {
                if(item instanceof Chord) {
                    return item.tetraTonnetz(transformation, tonnetz);
                } else return item;
            }).flat(Infinity) as ZEvent[];
        }
        return this;
    }

    hexaCycle(tonnetz: TonnetzSpaces = [3, 4, 5]): Ziffers {
        if(this.evaluated) {
            this.evaluated = this.evaluated.map((item: ZEvent) => {
                if(item instanceof Pitch) {
                    const chordCycle = hexaCycles(item.pitch as number, tonnetz);
                    const zCycle = chordCycle.map((chord: number[]) => {
                        return Chord.fromPitchClassArray(chord, (item.key || "C4"), (item.scaleName || "MAJOR")).evaluate();
                    });
                    return zCycle as ZEvent[];
                }
                return item;
            }).flat(Infinity) as ZEvent[];
        }
        return this;
    }

    octaCycle(tonnetz: TonnetzSpaces = [3, 4, 5]): Ziffers {
        if(this.evaluated) {
            this.evaluated = this.evaluated.map((item: ZEvent) => {
                if(item instanceof Pitch) {
                    const chordCycle = octaCycles(item.pitch as number, tonnetz);
                    const zCycle = chordCycle.map((chord: number[]) => {
                        return Chord.fromPitchClassArray(chord, (item.key || "C4"), (item.scaleName || "MAJOR")).evaluate();
                    });
                    return zCycle as ZEvent[];
                }
                return item;
            }).flat(Infinity) as ZEvent[];
        }
        return this;
    }

    enneaCycle(tonnetz: TonnetzSpaces = [3, 4, 5]): Ziffers {
        if(this.evaluated) {
            this.evaluated = this.evaluated.map((item: ZEvent) => {
                if(item instanceof Pitch) {
                    const chordCycle = enneaCycles(item.pitch as number, tonnetz);
                    const zCycle = chordCycle.map((chord: number[]) => {
                        return Chord.fromPitchClassArray(chord, (item.key || "C4"), (item.scaleName || "MAJOR")).evaluate();
                    });
                    return zCycle as ZEvent[];
                }
                return item;
            }).flat(Infinity) as ZEvent[];
        }
        return this;
    }

}

const resolveSubdivisions = (values: (Chord|Rest|Pitch|SoundEvent|Subdivision)[], duration: number|undefined = undefined): ZEvent[] => {
    const sub = values.map((item: Chord|Rest|Pitch|SoundEvent|Subdivision) => {
        if(item instanceof Subdivision) {
            const length = item.evaluated.length
            const newDuration = (duration || item.duration) / length;
            return resolveSubdivisions(item.evaluated, newDuration);
        } else {
            item.duration = duration || item.duration;
            return item;
        }
    });
    return sub.flat(Infinity) as ZEvent[];
}

const getGlobalOption = (options: NodeOptions): GlobalOptions => {
    let globalOptions: GlobalOptions = {};
    globalOptionKeys.forEach((key: string) => {
        if(options[key as keyof GlobalOptions] !== undefined) {
            const val = options[key as keyof GlobalOptions];
            globalOptions[key as keyof GlobalOptions] = val;
            delete options[key as keyof GlobalOptions];
        }
    });
    return globalOptions;
}

export const pattern = (input: string, options: object = {}): Ziffers => {
    return new Ziffers(input, options);
}


// TODO: REMOVE?
export function* cycle(generaterFn: (...kwargs: any[]) => Generator<number>, ...kwargs: any[]): Generator<number> {
    let generator = generaterFn(...kwargs);
    while (true) {
      const result = generator.next();
      if (result.done) {
        generator = generaterFn(...kwargs);
      } else {
        yield result.value;
      }
    }
  }

  export function collect(count: number, generatorFn: (...kwargs: any[]) => Generator<number>, ...kwargs: any[]): number[] {
    const collectedValues: number[] = [];
    let generator = generatorFn(...kwargs);
  
    for (let i = 0; i < count; i++) {
      const result = generator.next();
      if (result.done) {
        generator = generatorFn(...kwargs);
      } else {
        collectedValues.push(result.value);
      }
    }
  
    return collectedValues;
  }