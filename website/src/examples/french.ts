import type {Labels} from '@crosswalkjs/canvas';

// The operators' names in French, by id. Anything not here keeps its own name.
const operatorNames: Record<string, string> = {
  'text.concat': 'Concaténer',
  'text.upper': 'Majuscules',
  'convert.lookup': 'Table de correspondance',
  'aggregate.sum': 'Somme',
};

/** Some of the editor's wording in French, to show `labels` at work. Anything left out stays in English. */
export const french: Partial<Labels> = {
  operators: 'Opérateurs',
  findOperator: 'Chercher un opérateur',
  toolboxHint: 'Glissez un opérateur sur la grille, puis des champs dessus.',
  notes: 'Notes',
  showing: 'Affichage',
  mainMap: 'Carte principale',
  close: 'Fermer',
  inputs: 'Entrées',
  inputLabel: (index) => `Entrée ${index + 1}`,
  deleteOperator: "Supprimer l'opérateur",
  zoomIn: 'Agrandir',
  zoomOut: 'Réduire',
  findField: (side) => (side === 'source' ? 'Chercher un champ source' : 'Chercher un champ cible'),
  operator: (definition) => ({label: operatorNames[definition.id] ?? definition.label}),
  // Issues have a code, so they can be worded by it.
  issue: (issue) => (issue.code === 'input-count' ? "Cet opérateur n'a pas assez d'entrées." : issue.message),
};
