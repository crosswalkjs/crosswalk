import { createMapper } from "@crosswalkjs/canvas";
import startingMap from "./order.map.json";

// The operators' names in French, by id. Anything not here keeps its own name.
const operatorNames = {
  "text.concat": "Concaténer",
  "text.upper": "Majuscules",
  "convert.lookup": "Table de correspondance",
  "aggregate.sum": "Somme",
};

createMapper(document.getElementById("mapper"), {
  document: startingMap,
  labels: {
    operators: "Opérateurs",
    findOperator: "Chercher un opérateur",
    toolboxHint: "Glissez un opérateur sur la grille, puis des champs dessus.",
    notes: "Notes",
    showing: "Affichage",
    mainMap: "Carte principale",
    close: "Fermer",
    inputs: "Entrées",
    inputLabel: (index) => `Entrée ${index + 1}`,
    deleteOperator: "Supprimer l'opérateur",
    zoomIn: "Agrandir",
    zoomOut: "Réduire",
    findField: (side) => (side === "source" ? "Chercher un champ source" : "Chercher un champ cible"),
    operator: (definition) => ({ label: operatorNames[definition.id] ?? definition.label }),
    // Issues have a code, so they can be worded by it.
    issue: (issue) => (issue.code === "input-count" ? "Cet opérateur n'a pas assez d'entrées." : issue.message),
  },
});
