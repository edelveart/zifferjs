// @ts-nocheck
import { pattern,note } from './ziffers';
import { SCALES } from './defaults';
import { parse as parseScale } from './parser/scalaParser.ts'
import { freqToMidi, midiToFreq, resolvePitchBend, stepsToScale, scaleToSteps, numberToScale} from './scale.ts';


try {
  const yep = pattern('e {11 22 3*2+1/2 4}');
  console.log(yep);
  // This should output: 4// This should output: 4
//console.log('Parsed result:', result);
  //const test = next('1 2 3').scale('minor');
 //console.log(test);
  //console.log(result.evaluate());
} catch (error) {
  console.error('Error while parsing:', error);
}