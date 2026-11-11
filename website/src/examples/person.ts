import type {JsonValue, MapDocument} from '@crosswalkjs/core';
import map from '../../../packages/core/test/fixtures/person.map.json';
import input from '../../../packages/core/test/fixtures/person.input.json';

// The same example the library's tests use.
export const personMap = map as MapDocument;
export const personInput = input as JsonValue;

/** The Person schemas with nothing mapped yet, to build from scratch. */
export const blankPersonMap: MapDocument = {version: 1, source: personMap.source, target: personMap.target, nodes: [], links: []};
