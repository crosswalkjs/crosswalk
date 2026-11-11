export type { JsonValue, Link, LinkSource, LinkTarget, Loop, MapDocument, Note, NoteAnchor, FlatHint, OperatorNode, Page, Schema, SortKey, SubMap, XmlHint } from "./types.js";
export { ABSENT, isAbsent, type Absent, type Value } from "./value.js";
export { arrayScopes, childPath, escapeKey, inferSchema, isValueSchema, listFields, parsePath, resolveSchema, schemaAt, unresolvedRefs, type Field, type PathSegment } from "./paths.js";
export { openApiSchemas, type OpenApiSchema } from "./openapi.js";
export { bundleSchema } from "./bundle.js";
export { inferXmlSchema, jsonToXml, parseXml, xmlToJson, type XmlElement, type XmlWriteOptions } from "./xml.js";
export { xsdSchemas, type XsdSchema } from "./xsd.js";
export { inferCsvSchema, readFlatFile, writeFlatFile } from "./flat.js";

export {
  defineCategory,
  defineOperator,
  OperatorError,
  type AggregateOperator,
  type AsyncValueOperator,
  type CategoryDefinition,
  type OperatorContext,
  type OperatorDefinition,
  type ValueOperator,
} from "./operators/types.js";
export { compare, isNumeric, toBoolean, toNumber, toText } from "./operators/coerce.js";
export { builtinCategories, builtinOperators } from "./operators/builtins.js";
export { createRegistry, OperatorRegistry, type RegistryOptions } from "./operators/registry.js";
export { registryFromCatalog, toCatalog, type CatalogOperator, type OperatorCatalog } from "./operators/catalog.js";

export { analyseMap, type Analysis, type IssueCode, type MapIssue, type MapPlan, type PlannedNode } from "./analyse.js";
export {
  createAsyncTransform,
  createTransform,
  limitsForUserMaps,
  MapLimitError,
  MapRuntimeError,
  MapValidationError,
  transform,
  type AsyncTransform,
  type AsyncTransformOptions,
  type RunLimits,
  type RunOptions,
  type Transform,
  type TransformOptions,
} from "./transform.js";
export { handlePreview, type PreviewRequest, type PreviewResponse } from "./preview.js";
