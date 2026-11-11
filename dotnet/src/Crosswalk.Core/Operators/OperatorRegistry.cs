using System.Text.Json.Nodes;

namespace Crosswalk.Operators;

/// <summary>Which operators a registry holds. See <see cref="OperatorRegistry.Create"/>.</summary>
public sealed class RegistryOptions
{
    /// <summary>Which built-ins to include: all of them when null (the default), or those the filter keeps. Use <c>_ => false</c> for none.</summary>
    public Func<OperatorDefinition, bool>? Builtins { get; init; }

    /// <summary>Your own operators, added after the built-ins.</summary>
    public IEnumerable<OperatorDefinition> Operators { get; init; } = [];

    /// <summary>Your own categories, or replacements for built-in ones.</summary>
    public IEnumerable<CategoryDefinition> Categories { get; init; } = [];
}

/// <summary>The operators a map can use, by id, and the categories that group them.</summary>
public sealed class OperatorRegistry
{
    private readonly Dictionary<string, OperatorDefinition> _operators = [];
    private readonly List<OperatorDefinition> _order = [];
    private readonly Dictionary<string, CategoryDefinition> _categories = [];
    private readonly List<string> _categoryOrder = [];

    /// <summary>A registry of the built-in operators, or some of them, plus any of your own.</summary>
    public static OperatorRegistry Create(RegistryOptions? options = null)
    {
        options ??= new RegistryOptions();
        var registry = new OperatorRegistry();
        foreach (var category in BuiltinOperators.Categories) registry.RegisterCategory(category);
        foreach (var category in options.Categories) registry.RegisterCategory(category);
        foreach (var definition in BuiltinOperators.All)
        {
            if (options.Builtins is null || options.Builtins(definition)) registry.Register(definition);
        }
        foreach (var definition in options.Operators) registry.Register(definition);
        return registry;
    }

    /// <summary>Adds a category, or replaces one with the same id, such as to relabel a built-in.</summary>
    public OperatorRegistry RegisterCategory(CategoryDefinition category)
    {
        if (!_categories.ContainsKey(category.Id)) _categoryOrder.Add(category.Id);
        _categories[category.Id] = category;
        return this;
    }

    /// <summary>Adds an operator. Its category is created, labelled with its id, if it isn't registered yet.</summary>
    public OperatorRegistry Register(OperatorDefinition definition)
    {
        if (_operators.ContainsKey(definition.Id)) throw new ArgumentException($"Operator \"{definition.Id}\" is already registered", nameof(definition));
        if (!_categories.ContainsKey(definition.Category)) RegisterCategory(new CategoryDefinition(definition.Category, definition.Category));
        _operators[definition.Id] = definition;
        _order.Add(definition);
        return this;
    }

    /// <summary>Removes an operator. Maps that use it then report it as unknown.</summary>
    public OperatorRegistry Unregister(string id)
    {
        if (_operators.Remove(id, out var definition)) _order.Remove(definition);
        return this;
    }

    public OperatorDefinition? Get(string id) => _operators.GetValueOrDefault(id);

    public bool Has(string id) => _operators.ContainsKey(id);

    /// <summary>Every operator, in the order registered.</summary>
    public IReadOnlyList<OperatorDefinition> List() => [.. _order];

    public CategoryDefinition? GetCategory(string id) => _categories.GetValueOrDefault(id);

    /// <summary>Every category with at least one operator, in the order registered.</summary>
    public IReadOnlyList<CategoryDefinition> Categories()
    {
        var used = _order.Select(o => o.Category).ToHashSet();
        return _categoryOrder.Where(used.Contains).Select(id => _categories[id]).ToList();
    }

    /// <summary>
    /// Describes the operators as JSON for a front end: ids, labels, categories and inputs,
    /// with no behaviour. Serve it so the editor's toolbox matches what this registry can run.
    /// </summary>
    public JsonObject ToCatalog()
    {
        var operators = new JsonArray();
        foreach (var definition in _order)
        {
            var inputs = new JsonObject { ["min"] = definition.Inputs.Min };
            if (definition.Inputs.Max is { } max) inputs["max"] = max;
            if (definition.Inputs.Labels is { } labels) inputs["labels"] = new JsonArray([.. labels.Select(l => (JsonNode?)l)]);
            if (definition.Inputs.Tables is { } tables) inputs["tables"] = new JsonArray([.. tables.Select(t => (JsonNode?)t)]);
            var entry = new JsonObject
            {
                ["id"] = definition.Id,
                ["kind"] = definition is AggregateOperator ? "aggregate" : "value",
                ["label"] = definition.Label,
                ["category"] = definition.Category,
                ["inputs"] = inputs,
            };
            if (definition is AsyncValueOperator) entry["async"] = true;
            if (definition.HandlesAbsent) entry["handlesAbsent"] = true;
            if (definition.Glyph is { } glyph) entry["glyph"] = glyph;
            if (definition.Description is { } description) entry["description"] = description;
            operators.Add((JsonNode)entry);
        }
        var categories = new JsonArray();
        foreach (var category in Categories())
        {
            var entry = new JsonObject { ["id"] = category.Id, ["label"] = category.Label };
            if (category.Color is { } color) entry["color"] = color;
            categories.Add((JsonNode)entry);
        }
        return new JsonObject { ["categories"] = categories, ["operators"] = operators };
    }
}
