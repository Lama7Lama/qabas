import {build} from './build.mjs';
// Review uses development content checks; it does not confer scientific approval.
// Do not distribute the private brand font in the hosted preview.
await build('dev','dist/review',{brandFontDir:'work/non-distributed-fonts'});
