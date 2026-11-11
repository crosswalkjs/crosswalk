import {defineCategory, defineOperator, toText} from '@crosswalkjs/core';

// The Person example's own operator, in a category of its own: Crosswalk has
// no date arithmetic built in, so the host supplies it.
export const categories = [defineCategory({id: 'people', label: 'People', color: '#0e9f6e'})];

export const operators = [
  defineOperator({
    kind: 'value',
    id: 'example.age',
    label: 'Age',
    glyph: 'Ag',
    category: 'people',
    inputs: {min: 1, max: 1},
    run: ([dateOfBirth]) => {
      const today = new Date();
      const born = new Date(`${toText(dateOfBirth ?? null)}T00:00:00Z`);
      if (Number.isNaN(born.getTime())) throw new Error(`"${toText(dateOfBirth ?? null)}" isn't a date`);
      const birthdayPassed =
        today.getUTCMonth() > born.getUTCMonth() ||
        (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() >= born.getUTCDate());
      return today.getUTCFullYear() - born.getUTCFullYear() - (birthdayPassed ? 0 : 1);
    },
  }),
];
