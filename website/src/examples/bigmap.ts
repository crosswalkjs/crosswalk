import type {JsonValue, Link, Loop, MapDocument, Note, OperatorNode, Page, Schema, SubMap} from '@crosswalkjs/core';

/*
 * A web shop's order mapped to an ERP sales order, the kind of map a real
 * integration ends up with: a few hundred fields each side, nested records and
 * lists inside lists, lookups, dates, totals checked against each other, an
 * address sub-map used three times, and the work split across pages.
 *
 * It's written as rules rather than drawn: each target field gets an expression
 * of operators, and `buildMap` turns the rules into nodes, links and positions.
 * `copies` repeats the whole thing side by side, as a batch of orders, to see
 * how the editor copes as a map grows.
 */

// ---- schemas ----

const str: Schema = {type: 'string'};
const num: Schema = {type: 'number'};
const int: Schema = {type: 'integer'};
const bool: Schema = {type: 'boolean'};
const when: Schema = {type: 'string', format: 'date-time'};
const day: Schema = {type: 'string', format: 'date'};
const rec = (properties: Record<string, Schema>, title?: string): Schema => ({type: 'object', ...(title ? {title} : {}), properties});
const list = (items: Schema): Schema => ({type: 'array', items});

const webAddress = rec({Recipient: str, Line1: str, Line2: str, City: str, Region: str, Postcode: str, Country: str, Instructions: str}, 'Address');

const webOrder = rec(
  {
    OrderNumber: str,
    OrderDate: when,
    Channel: str,
    Market: str,
    Locale: str,
    Currency: str,
    Status: str,
    ShippingMethod: str,
    Notes: str,
    Customer: rec({
      Id: str,
      Title: str,
      FirstName: str,
      LastName: str,
      Email: str,
      Phone: str,
      DateOfBirth: day,
      PurchaseOrder: str,
      Company: rec({Name: str, VatNumber: str}),
      Loyalty: rec({Tier: str, Points: str, MemberSince: day}),
      Marketing: rec({Email: bool, Sms: bool, Post: bool}),
    }),
    BillingAddress: webAddress,
    ShippingAddress: webAddress,
    Lines: list(
      rec({
        LineNumber: int,
        Sku: str,
        Name: str,
        Variant: rec({Size: str, Colour: str}),
        Qty: int,
        UnitPrice: num,
        LineTotal: num,
        Discount: rec({Code: str, Amount: num}),
        Tax: rec({Rate: num, Amount: num}),
        Warehouse: str,
        Weight: num,
        Dimensions: rec({Length: num, Width: num, Height: num}),
        GiftWrap: str,
        Personalisation: rec({Text: str, Font: str}),
        Bundle: list(rec({Sku: str, Qty: int})),
      }),
    ),
    Promotions: list(rec({Code: str, Type: str, Amount: num})),
    Payment: rec({
      Method: str,
      Provider: str,
      CardBrand: str,
      Last4: str,
      AuthCode: str,
      Amount: num,
      CapturedAt: when,
      Instalments: list(rec({Due: day, Amount: num})),
    }),
    Shipments: list(
      rec({
        Carrier: str,
        Service: str,
        Tracking: str,
        ShippedAt: when,
        Packages: list(rec({Weight: num, Items: list(rec({Sku: str, Qty: int}))})),
      }),
    ),
    Totals: rec({Subtotal: num, Discount: num, Tax: num, Shipping: num, Grand: num}),
    Fraud: rec({Score: num, Rules: list(rec({Id: str, Result: str}))}),
    Meta: rec({Source: str, UserAgent: str, Ip: str, CreatedAt: when, UpdatedAt: when, Tags: list(str)}),
  },
  'Web order',
);

const erpAddress = rec({Street: str, Street2: str, City: str, Region: str, PostalCode: str, CountryCode: str, CountryName: str}, 'ERP address');
const party = (extra: Record<string, Schema>) => rec({CustomerNumber: str, Name: str, Address: erpAddress, ...extra});

const salesOrder = rec(
  {
    Header: rec({
      DocumentType: str,
      ExternalReference: str,
      CustomerPO: str,
      DocumentDate: str,
      PostingDate: str,
      RequestedDelivery: str,
      Currency: str,
      SalesOrganisation: str,
      DistributionChannel: str,
      Division: str,
      OrderReason: str,
      Language: str,
      Priority: str,
      Status: str,
      HeaderText: str,
    }),
    Partners: rec({
      SoldTo: party({
        Title: str,
        Email: str,
        Phone: str,
        Company: str,
        VatNumber: str,
        Age: int,
        LoyaltyTier: str,
        LoyaltyPoints: num,
        LoyaltyYears: int,
        MarketingConsent: bool,
      }),
      ShipTo: party({Instructions: str}),
      BillTo: party({}),
      Payer: rec({CustomerNumber: str}),
    }),
    Items: list(
      rec({
        ItemNumber: int,
        Material: str,
        Description: str,
        Quantity: num,
        Unit: str,
        NetPrice: num,
        NetValue: num,
        GrossValue: num,
        DiscountPercent: num,
        TaxCode: str,
        TaxAmount: num,
        Plant: str,
        StorageLocation: str,
        GrossWeight: num,
        Volume: num,
        GiftWrap: bool,
        FreeOfCharge: bool,
        PersonalisationText: str,
        Components: list(rec({Material: str, Quantity: num})),
      }),
    ),
    Pricing: rec({
      Subtotal: num,
      DiscountTotal: num,
      TaxTotal: num,
      Shipping: num,
      GrandTotal: num,
      Difference: num,
      Balanced: bool,
      ItemCount: int,
      UnitCount: num,
      HeaviestItem: num,
      AveragePrice: num,
      PromotionCodes: str,
      Conditions: list(rec({Type: str, Code: str, Amount: num})),
    }),
    Payment: rec({
      Method: str,
      Terms: str,
      CardType: str,
      MaskedCard: str,
      Provider: str,
      Authorisation: str,
      AuthorisedAmount: num,
      CapturedOn: str,
      Outstanding: num,
      FraudCheck: str,
      FraudRules: str,
      Schedule: list(rec({DueDate: str, Amount: num})),
    }),
    Delivery: rec({
      Carrier: str,
      ServiceLevel: str,
      Incoterms: str,
      Deliveries: list(
        rec({
          Carrier: str,
          Service: str,
          Tracking: str,
          ShippedOn: str,
          PackageCount: int,
          TotalWeight: num,
          Packages: list(rec({Weight: num, ItemCount: int, Units: num})),
        }),
      ),
    }),
    Audit: rec({
      SourceSystem: str,
      Channel: str,
      CreatedOn: str,
      UpdatedOn: str,
      DaysSinceOrder: int,
      IpAddress: str,
      UserAgent: str,
      Tags: str,
      FraudScore: num,
    }),
  },
  'ERP sales order',
);

// ---- rules ----

/** What a target field is made from: a source field, a fixed value, or an operator over more of the same. */
type Expr = string | {value: JsonValue} | Call;
type Call = {op: string; args: Expr[]; scope?: string};

const value = (v: JsonValue): Expr => ({value: v});
const op = (operator: string, ...args: Expr[]): Expr => ({op: operator, args});
/** An aggregate, over the repeating record `scope`. */
const agg = (operator: string, scope: string, field: string): Expr => ({op: operator, args: [field], scope});

const upper = (e: Expr) => op('text.upper', e);
const lower = (e: Expr) => op('text.lower', e);
const trim = (e: Expr) => op('text.trim', e);
const join = (...e: Expr[]) => op('text.concat', ...e);
const round = (e: Expr, places: number) => op('math.round', e, value(places));
const lookup = (e: Expr, table: Record<string, JsonValue>, otherwise?: JsonValue) => op('convert.lookup', e, value(table), ...(otherwise === undefined ? [] : [value(otherwise)]));
const isoDate = (e: Expr) => op('date.parse', e, value('yyyy-MM-ddTHH:mm:ssZ'));
const erpDate = (e: Expr) => op('date.format', e, value('yyyyMMdd'));
const fixed = (v: JsonValue) => join(value(v));
const fullName = (first: string, last: string) => trim(join(first, value(' '), last));
const customerNumber = join(value('C'), op('text.right', join(value('0000000000'), 'Customer.Id'), value(10)));

/** A rule: the target field, what it's made from, and the page it's drawn on. */
interface Rule {
  to: string;
  from: Expr;
}

interface Section {
  page: string;
  rules: Rule[];
  /** Record links through a sub-map, by source and target record. */
  records?: {from: string; to: string; submap: string}[];
  loops?: Loop[];
  notes?: {text: string; on?: string}[];
}

const countries = {GB: 'United Kingdom', IE: 'Ireland', FR: 'France', DE: 'Germany', ES: 'Spain', NL: 'Netherlands', IT: 'Italy'};

const sections: Section[] = [
  {
    page: 'Header',
    rules: [
      {to: 'Header.DocumentType', from: fixed('ZOR')},
      {to: 'Header.ExternalReference', from: upper('OrderNumber')},
      {to: 'Header.CustomerPO', from: op('flow.firstOf', 'Customer.PurchaseOrder', 'OrderNumber')},
      {to: 'Header.DocumentDate', from: erpDate(isoDate('OrderDate'))},
      {to: 'Header.PostingDate', from: erpDate(op('date.today'))},
      {
        to: 'Header.RequestedDelivery',
        from: erpDate(op('date.add', isoDate('OrderDate'), lookup('ShippingMethod', {standard: 5, express: 2, nextday: 1}, 5), value('days'))),
      },
      {to: 'Header.Currency', from: upper(trim('Currency'))},
      {to: 'Header.SalesOrganisation', from: lookup('Market', {GB: '1000', IE: '1100', FR: '2000', DE: '2100', ES: '2200'}, '1000')},
      {to: 'Header.DistributionChannel', from: lookup('Channel', {web: '10', app: '11', marketplace: '20', store: '30'}, '10')},
      {to: 'Header.Division', from: fixed('00')},
      {
        to: 'Header.OrderReason',
        from: op('flow.ifElse', op('logic.greaterThan', agg('aggregate.count', 'Promotions[]', 'Promotions[].Code'), value(0)), value('PRM'), value('STD')),
      },
      {to: 'Header.Language', from: upper(op('text.left', 'Locale', value(2)))},
      {to: 'Header.Priority', from: op('flow.ifElse', op('logic.equal', 'ShippingMethod', value('nextday')), value('01'), value('03'))},
      {to: 'Header.Status', from: lookup(lower('Status'), {placed: 'A', paid: 'B', cancelled: 'C', 'on-hold': 'H'}, 'A')},
      {to: 'Header.HeaderText', from: op('text.left', trim('Notes'), value(132))},
    ],
    notes: [{text: 'Delivery dates are working days only in the ERP; it moves weekends on by itself.', on: 'Header.RequestedDelivery'}],
  },
  {
    page: 'Parties',
    rules: [
      {to: 'Partners.SoldTo.CustomerNumber', from: customerNumber},
      {to: 'Partners.SoldTo.Name', from: fullName('Customer.FirstName', 'Customer.LastName')},
      {to: 'Partners.SoldTo.Title', from: lookup('Customer.Title', {Mr: '0002', Mrs: '0001', Ms: '0001', Mx: '0004', Dr: '0003'}, '')},
      {to: 'Partners.SoldTo.Email', from: lower(trim('Customer.Email'))},
      {to: 'Partners.SoldTo.Phone', from: op('text.replace', op('text.replace', 'Customer.Phone', value(' '), value('')), value('-'), value(''))},
      {to: 'Partners.SoldTo.Company', from: op('flow.firstOf', 'Customer.Company.Name', fullName('Customer.FirstName', 'Customer.LastName'))},
      {to: 'Partners.SoldTo.VatNumber', from: upper(op('text.replace', 'Customer.Company.VatNumber', value(' '), value('')))},
      {to: 'Partners.SoldTo.Age', from: op('date.diff', 'Customer.DateOfBirth', op('date.today'), value('years'))},
      {to: 'Partners.SoldTo.LoyaltyTier', from: lookup(lower('Customer.Loyalty.Tier'), {bronze: 'B', silver: 'S', gold: 'G', platinum: 'P'}, 'N')},
      {to: 'Partners.SoldTo.LoyaltyPoints', from: op('convert.toNumber', 'Customer.Loyalty.Points')},
      {to: 'Partners.SoldTo.LoyaltyYears', from: op('date.diff', 'Customer.Loyalty.MemberSince', op('date.today'), value('years'))},
      {to: 'Partners.SoldTo.MarketingConsent', from: op('logic.or', 'Customer.Marketing.Email', 'Customer.Marketing.Sms', 'Customer.Marketing.Post')},
      {to: 'Partners.ShipTo.CustomerNumber', from: customerNumber},
      {to: 'Partners.ShipTo.Name', from: op('flow.firstOf', 'ShippingAddress.Recipient', fullName('Customer.FirstName', 'Customer.LastName'))},
      {to: 'Partners.ShipTo.Instructions', from: op('text.left', trim('ShippingAddress.Instructions'), value(60))},
      {to: 'Partners.BillTo.CustomerNumber', from: customerNumber},
      {to: 'Partners.BillTo.Name', from: op('flow.firstOf', 'BillingAddress.Recipient', 'Customer.Company.Name', fullName('Customer.FirstName', 'Customer.LastName'))},
      {to: 'Partners.Payer.CustomerNumber', from: customerNumber},
    ],
    records: [
      {from: 'BillingAddress', to: 'Partners.SoldTo.Address', submap: 'Address'},
      {from: 'ShippingAddress', to: 'Partners.ShipTo.Address', submap: 'Address'},
      {from: 'BillingAddress', to: 'Partners.BillTo.Address', submap: 'Address'},
    ],
    notes: [{text: 'Customer numbers are the web id padded to ten digits. The ERP creates the account on first order.', on: 'Partners.SoldTo.CustomerNumber'}],
  },
  {
    page: 'Items',
    loops: [
      {source: 'Lines[]', target: 'Items[]', sortBy: [{path: 'Lines[].LineNumber'}]},
      {source: 'Lines[].Bundle[]', target: 'Items[].Components[]'},
    ],
    rules: [
      {to: 'Items[].ItemNumber', from: op('math.multiply', 'Lines[].LineNumber', value(10))},
      {to: 'Items[].Material', from: upper(trim('Lines[].Sku'))},
      {to: 'Items[].Description', from: op('text.left', join('Lines[].Name', value(' '), 'Lines[].Variant.Colour', value(' '), 'Lines[].Variant.Size'), value(40))},
      {to: 'Items[].Quantity', from: op('convert.toNumber', 'Lines[].Qty')},
      {to: 'Items[].Unit', from: fixed('EA')},
      {to: 'Items[].NetPrice', from: round(op('math.subtract', 'Lines[].UnitPrice', op('math.divide', 'Lines[].Discount.Amount', 'Lines[].Qty')), 2)},
      {
        to: 'Items[].NetValue',
        from: round(op('math.multiply', op('math.subtract', 'Lines[].UnitPrice', op('math.divide', 'Lines[].Discount.Amount', 'Lines[].Qty')), 'Lines[].Qty'), 2),
      },
      {to: 'Items[].GrossValue', from: round(op('math.multiply', 'Lines[].UnitPrice', 'Lines[].Qty'), 2)},
      {
        to: 'Items[].DiscountPercent',
        from: round(op('math.multiply', op('math.divide', 'Lines[].Discount.Amount', op('math.multiply', 'Lines[].UnitPrice', 'Lines[].Qty')), value(100)), 1),
      },
      {to: 'Items[].TaxCode', from: lookup(op('convert.toText', 'Lines[].Tax.Rate'), {'20': 'A1', '5': 'A2', '0': 'A0'}, 'A9')},
      {to: 'Items[].TaxAmount', from: round('Lines[].Tax.Amount', 2)},
      {to: 'Items[].Plant', from: lookup(upper('Lines[].Warehouse'), {LDN: '1010', MAN: '1020', DUB: '1110', PAR: '2010'}, '1010')},
      {to: 'Items[].StorageLocation', from: join(upper(op('text.left', 'Lines[].Warehouse', value(3))), value('-'), fixed('01'))},
      {to: 'Items[].GrossWeight', from: round(op('math.multiply', 'Lines[].Weight', 'Lines[].Qty'), 3)},
      {
        to: 'Items[].Volume',
        from: round(
          op('math.divide', op('math.multiply', 'Lines[].Dimensions.Length', 'Lines[].Dimensions.Width', 'Lines[].Dimensions.Height'), value(1000000)),
          4,
        ),
      },
      {to: 'Items[].GiftWrap', from: op('convert.toBoolean', 'Lines[].GiftWrap')},
      {to: 'Items[].FreeOfCharge', from: op('logic.equal', 'Lines[].UnitPrice', value(0))},
      {
        to: 'Items[].PersonalisationText',
        from: op(
          'flow.onlyIf',
          op('logic.exists', 'Lines[].Personalisation.Text'),
          join(upper(trim('Lines[].Personalisation.Text')), value(' ('), 'Lines[].Personalisation.Font', value(')')),
        ),
      },
      {to: 'Items[].Components[].Material', from: upper('Lines[].Bundle[].Sku')},
      {to: 'Items[].Components[].Quantity', from: op('math.multiply', 'Lines[].Bundle[].Qty', 'Lines[].Qty')},
    ],
    notes: [{text: 'A bundle is one line on the web; the ERP wants each component as well, for picking.', on: 'Items[].Components[].Material'}],
  },
  {
    page: 'Pricing',
    loops: [{source: 'Promotions[]', target: 'Pricing.Conditions[]'}],
    rules: [
      {to: 'Pricing.Subtotal', from: round(agg('aggregate.sum', 'Lines[]', 'Lines[].LineTotal'), 2)},
      {
        to: 'Pricing.DiscountTotal',
        from: round(op('math.add', agg('aggregate.sum', 'Lines[]', 'Lines[].Discount.Amount'), agg('aggregate.sum', 'Promotions[]', 'Promotions[].Amount')), 2),
      },
      {to: 'Pricing.TaxTotal', from: round(agg('aggregate.sum', 'Lines[]', 'Lines[].Tax.Amount'), 2)},
      {to: 'Pricing.Shipping', from: round('Totals.Shipping', 2)},
      {
        to: 'Pricing.GrandTotal',
        from: round(
          op(
            'math.subtract',
            op('math.add', agg('aggregate.sum', 'Lines[]', 'Lines[].LineTotal'), agg('aggregate.sum', 'Lines[]', 'Lines[].Tax.Amount'), 'Totals.Shipping'),
            agg('aggregate.sum', 'Promotions[]', 'Promotions[].Amount'),
          ),
          2,
        ),
      },
      {
        to: 'Pricing.Difference',
        from: round(
          op(
            'math.subtract',
            'Totals.Grand',
            op(
              'math.subtract',
              op('math.add', agg('aggregate.sum', 'Lines[]', 'Lines[].LineTotal'), agg('aggregate.sum', 'Lines[]', 'Lines[].Tax.Amount'), 'Totals.Shipping'),
              agg('aggregate.sum', 'Promotions[]', 'Promotions[].Amount'),
            ),
          ),
          2,
        ),
      },
      {
        to: 'Pricing.Balanced',
        from: op(
          'logic.lessThan',
          op(
            'math.abs',
            op(
              'math.subtract',
              'Totals.Grand',
              op(
                'math.subtract',
                op('math.add', agg('aggregate.sum', 'Lines[]', 'Lines[].LineTotal'), agg('aggregate.sum', 'Lines[]', 'Lines[].Tax.Amount'), 'Totals.Shipping'),
                agg('aggregate.sum', 'Promotions[]', 'Promotions[].Amount'),
              ),
            ),
          ),
          value(0.01),
        ),
      },
      {to: 'Pricing.ItemCount', from: agg('aggregate.count', 'Lines[]', 'Lines[].Sku')},
      {to: 'Pricing.UnitCount', from: agg('aggregate.sum', 'Lines[]', 'Lines[].Qty')},
      {to: 'Pricing.HeaviestItem', from: agg('aggregate.max', 'Lines[]', 'Lines[].Weight')},
      {to: 'Pricing.AveragePrice', from: round(agg('aggregate.average', 'Lines[]', 'Lines[].UnitPrice'), 2)},
      {to: 'Pricing.PromotionCodes', from: agg('aggregate.join', 'Promotions[]', 'Promotions[].Code')},
      {to: 'Pricing.Conditions[].Type', from: lookup(lower('Promotions[].Type'), {percent: 'ZPC', fixed: 'ZFX', shipping: 'ZSH'}, 'ZOT')},
      {to: 'Pricing.Conditions[].Code', from: upper(trim('Promotions[].Code'))},
      {to: 'Pricing.Conditions[].Amount', from: op('math.multiply', 'Promotions[].Amount', value(-1))},
    ],
    notes: [{text: 'Balanced is false when the web total and ours differ by a penny or more. Finance want those held.', on: 'Pricing.Balanced'}],
  },
  {
    page: 'Payment',
    loops: [{source: 'Payment.Instalments[]', target: 'Payment.Schedule[]', sortBy: [{path: 'Payment.Instalments[].Due'}]}],
    rules: [
      {to: 'Payment.Method', from: lookup(lower('Payment.Method'), {card: 'C', paypal: 'P', klarna: 'K', giftcard: 'G'}, 'X')},
      {to: 'Payment.Terms', from: op('flow.ifElse', op('logic.equal', lower('Payment.Method'), value('klarna')), value('Z030'), value('Z000'))},
      {
        to: 'Payment.CardType',
        from: op('flow.onlyIf', op('logic.equal', lower('Payment.Method'), value('card')), lookup(lower('Payment.CardBrand'), {visa: 'VISA', mastercard: 'MC', amex: 'AMEX'}, 'OTH')),
      },
      {to: 'Payment.MaskedCard', from: op('flow.onlyIf', op('logic.exists', 'Payment.Last4'), join(value('**** **** **** '), 'Payment.Last4'))},
      {to: 'Payment.Provider', from: upper('Payment.Provider')},
      {to: 'Payment.Authorisation', from: upper(trim('Payment.AuthCode'))},
      {to: 'Payment.AuthorisedAmount', from: round('Payment.Amount', 2)},
      {to: 'Payment.CapturedOn', from: erpDate(isoDate('Payment.CapturedAt'))},
      {to: 'Payment.Outstanding', from: round(op('math.max', op('math.subtract', 'Totals.Grand', 'Payment.Amount'), value(0)), 2)},
      {to: 'Payment.FraudCheck', from: op('flow.ifElse', op('logic.greaterOrEqual', 'Fraud.Score', value(70)), value('HOLD'), value('OK'))},
      {to: 'Payment.FraudRules', from: agg('aggregate.join', 'Fraud.Rules[]', 'Fraud.Rules[].Id')},
      {to: 'Payment.Schedule[].DueDate', from: erpDate('Payment.Instalments[].Due')},
      {to: 'Payment.Schedule[].Amount', from: round('Payment.Instalments[].Amount', 2)},
    ],
  },
  {
    page: 'Delivery',
    loops: [
      {source: 'Shipments[]', target: 'Delivery.Deliveries[]', sortBy: [{path: 'Shipments[].ShippedAt'}]},
      {source: 'Shipments[].Packages[]', target: 'Delivery.Deliveries[].Packages[]'},
    ],
    rules: [
      {to: 'Delivery.Carrier', from: lookup('ShippingMethod', {standard: 'RM', express: 'DPD', nextday: 'DHL'}, 'RM')},
      {to: 'Delivery.ServiceLevel', from: upper('ShippingMethod')},
      {
        to: 'Delivery.Incoterms',
        from: op('flow.ifElse', op('logic.equal', upper('ShippingAddress.Country'), upper('Market')), value('DAP'), value('DDP')),
      },
      {to: 'Delivery.Deliveries[].Carrier', from: upper('Shipments[].Carrier')},
      {to: 'Delivery.Deliveries[].Service', from: lookup(lower('Shipments[].Service'), {'48h': 'STD', '24h': 'EXP', am: 'PRI'}, 'STD')},
      {to: 'Delivery.Deliveries[].Tracking', from: upper(trim('Shipments[].Tracking'))},
      {to: 'Delivery.Deliveries[].ShippedOn', from: erpDate(isoDate('Shipments[].ShippedAt'))},
      {to: 'Delivery.Deliveries[].PackageCount', from: agg('aggregate.count', 'Shipments[].Packages[]', 'Shipments[].Packages[].Weight')},
      {to: 'Delivery.Deliveries[].TotalWeight', from: round(agg('aggregate.sum', 'Shipments[].Packages[]', 'Shipments[].Packages[].Weight'), 2)},
      {to: 'Delivery.Deliveries[].Packages[].Weight', from: round('Shipments[].Packages[].Weight', 2)},
      {to: 'Delivery.Deliveries[].Packages[].ItemCount', from: agg('aggregate.count', 'Shipments[].Packages[].Items[]', 'Shipments[].Packages[].Items[].Sku')},
      {to: 'Delivery.Deliveries[].Packages[].Units', from: agg('aggregate.sum', 'Shipments[].Packages[].Items[]', 'Shipments[].Packages[].Items[].Qty')},
    ],
  },
  {
    page: 'Audit',
    rules: [
      {to: 'Audit.SourceSystem', from: join(value('WEB-'), upper('Meta.Source'))},
      {to: 'Audit.Channel', from: 'Channel'},
      {to: 'Audit.CreatedOn', from: erpDate(isoDate('Meta.CreatedAt'))},
      {to: 'Audit.UpdatedOn', from: erpDate(isoDate('Meta.UpdatedAt'))},
      {to: 'Audit.DaysSinceOrder', from: op('date.diff', isoDate('OrderDate'), op('date.today'), value('days'))},
      {to: 'Audit.IpAddress', from: 'Meta.Ip'},
      {to: 'Audit.UserAgent', from: op('text.left', 'Meta.UserAgent', value(60))},
      {to: 'Audit.Tags', from: agg('aggregate.join', 'Meta.Tags[]', 'Meta.Tags[]')},
      {to: 'Audit.FraudScore', from: 'Fraud.Score'},
    ],
  },
];

/** The address sub-map: one web address to one ERP address. */
const addressRules: Rule[] = [
  {to: 'Street', from: trim('Line1')},
  {to: 'Street2', from: trim('Line2')},
  {to: 'City', from: trim('City')},
  {to: 'Region', from: 'Region'},
  {to: 'PostalCode', from: upper(op('text.replace', 'Postcode', value(' '), value('')))},
  {to: 'CountryCode', from: upper(trim('Country'))},
  {to: 'CountryName', from: lookup(upper(trim('Country')), countries, '')},
];

// ---- building ----

const COLUMN = 76;
const ROW = 50;

/** Collects the nodes and links rules make, placing each rule's operators as a little tree, inputs on the left. */
class Builder {
  nodes: OperatorNode[] = [];
  links: Link[] = [];
  private y = new Map<string, number>();
  // The lowest operator so far in each column of each page, so a parent placed between its inputs can't land on another.
  private lowest = new Map<string, number>();

  constructor(
    private readonly prefix: {source: string; target: string; id: string},
    private readonly top = 24,
    // Shared by a copy's pages, so ids don't repeat across them.
    private readonly ids = new Map<string, number>(),
  ) {}

  private id(operator: string) {
    const base = operator.split('.').pop()!;
    const n = (this.ids.get(base) ?? 0) + 1;
    this.ids.set(base, n);
    return `${base}${n}${this.prefix.id}`;
  }

  private path(side: 'source' | 'target', path: string) {
    return `${this.prefix[side]}${path}`;
  }

  /** The depth of an expression's deepest operator, so a page's trees can share columns. */
  static depth(e: Expr): number {
    return typeof e === 'object' && 'op' in e ? 1 + Math.max(0, ...e.args.map(Builder.depth)) : 0;
  }

  rule(rule: Rule, page: string | undefined, columns: number) {
    if (typeof rule.from === 'string') {
      this.links.push({from: {source: this.path('source', rule.from)}, to: {target: this.path('target', rule.to)}, ...(page ? {page} : {})});
      return;
    }
    if ('value' in rule.from) throw new Error(`${rule.to}: a fixed value needs an operator`);
    const key = page ?? '';
    let row = this.y.get(key) ?? this.top;
    // Places an operator and its inputs; returns its id and the height it was placed at.
    const place = (e: Call, depth: number): {id: string; y: number} => {
      const id = this.id(e.op);
      const node: OperatorNode = {id, operator: e.op, position: {x: 0, y: 0}, ...(page ? {page} : {})};
      if (e.scope) node.scope = this.path('source', e.scope);
      this.nodes.push(node);
      const ys: number[] = [];
      e.args.forEach((arg, input) => {
        if (typeof arg === 'string') this.links.push({from: {source: this.path('source', arg)}, to: {node: id, input}});
        else if ('value' in arg) node.constants = {...node.constants, [input]: arg.value};
        else {
          const child = place(arg, depth + 1);
          ys.push(child.y);
          this.links.push({from: {node: child.id}, to: {node: id, input}});
        }
      });
      let y: number;
      if (ys.length === 0) {
        y = row;
        row += ROW;
      } else y = Math.round(ys.reduce((a, b) => a + b, 0) / ys.length);
      const column = `${key}\n${depth}`;
      y = Math.max(y, (this.lowest.get(column) ?? -Infinity) + 44);
      this.lowest.set(column, y);
      row = Math.max(row, y + ROW);
      node.position = {x: 24 + (columns - depth) * COLUMN, y};
      return {id, y};
    };
    const root = place(rule.from, 1);
    this.links.push({from: {node: root.id}, to: {target: this.path('target', rule.to)}});
    this.y.set(key, row + 12);
  }

  /** Where the next rule on a page would go, to stack another copy below. */
  bottom(page: string | undefined) {
    return this.y.get(page ?? '') ?? this.top;
  }
}

/** The order-to-ERP map, with `copies` orders side by side. One copy has about 250 operators. */
export function buildMap(copies = 1): MapDocument {
  const pages: Page[] = sections.map((s) => ({id: s.page.toLowerCase(), name: s.page}));
  const nodes: OperatorNode[] = [];
  const links: Link[] = [];
  const loops: Loop[] = [];
  const notes: Note[] = [];
  const source: Record<string, Schema> = {};
  const target: Record<string, Schema> = {};
  // Each page's copies stack downwards.
  const tops = new Map<string, number>();

  for (let copy = 1; copy <= copies; copy++) {
    const single = copies === 1;
    const ids = new Map<string, number>();
    const prefix = single ? {source: '', target: '', id: ''} : {source: `Order${copy}.`, target: `SalesOrder${copy}.`, id: `_${copy}`};
    if (!single) {
      source[`Order${copy}`] = webOrder;
      target[`SalesOrder${copy}`] = salesOrder;
    }
    for (const section of sections) {
      const page = section.page.toLowerCase();
      const builder = new Builder(prefix, tops.get(page) ?? 24, ids);
      const columns = Math.max(...section.rules.map((r) => Builder.depth(r.from)));
      for (const rule of section.rules) builder.rule(rule, page, columns);
      tops.set(page, builder.bottom(page) + 40);
      nodes.push(...builder.nodes);
      links.push(...builder.links);
      for (const record of section.records ?? []) {
        links.push({from: {source: `${prefix.source}${record.from}`}, to: {target: `${prefix.target}${record.to}`}, submap: record.submap, page});
      }
      for (const loop of section.loops ?? []) {
        loops.push({
          ...loop,
          source: `${prefix.source}${loop.source}`,
          target: `${prefix.target}${loop.target}`,
          ...(loop.sortBy ? {sortBy: loop.sortBy.map((key) => ({...key, path: `${prefix.source}${key.path}`}))} : {}),
          page,
        });
      }
      if (copy === 1) {
        section.notes?.forEach((note, index) => {
          notes.push({
            id: `note-${page}-${index + 1}`,
            text: note.text,
            position: note.on ? {x: 0, y: 16} : {x: 24, y: 24},
            ...(note.on ? {on: {target: `${prefix.target}${note.on}`}} : {}),
            page,
          });
        });
      }
    }
  }

  const address = new Builder({source: '', target: '', id: ''});
  const addressColumns = Math.max(...addressRules.map((r) => Builder.depth(r.from)));
  for (const rule of addressRules) address.rule(rule, undefined, addressColumns);
  const submaps: Record<string, SubMap> = {
    Address: {title: 'Address', source: webAddress, target: erpAddress, nodes: address.nodes, links: address.links},
  };

  return {
    version: 1,
    source: copies === 1 ? webOrder : rec(source, 'Batch of web orders'),
    target: copies === 1 ? salesOrder : rec(target, 'Batch of sales orders'),
    nodes,
    links,
    loops,
    submaps,
    notes,
    pages,
  };
}

// ---- a sample order ----

const address = (recipient: string, line1: string, city: string, postcode: string, country: string): JsonValue => ({
  Recipient: recipient,
  Line1: line1,
  Line2: '',
  City: city,
  Region: '',
  Postcode: postcode,
  Country: country,
  Instructions: 'Leave with the concierge if out ',
});

const sampleOrder: JsonValue = {
  OrderNumber: 'wo-2026-118204',
  OrderDate: '2026-03-04T10:22:00Z',
  Channel: 'web',
  Market: 'GB',
  Locale: 'en-GB',
  Currency: 'gbp',
  Status: 'Paid',
  ShippingMethod: 'express',
  Notes: 'Birthday present, please no prices on the packing slip.',
  Customer: {
    Id: '48213',
    Title: 'Ms',
    FirstName: 'Ana',
    LastName: 'Silva',
    Email: ' Ana.Silva@Example.com',
    Phone: '+44 7700-900 123',
    DateOfBirth: '1988-11-02',
    PurchaseOrder: '',
    Company: {Name: '', VatNumber: ''},
    Loyalty: {Tier: 'Gold', Points: '1840', MemberSince: '2019-06-15'},
    Marketing: {Email: true, Sms: false, Post: false},
  },
  BillingAddress: address('Ana Silva', '12 Rua das Flores', 'Porto', '4050-123', 'pt'),
  ShippingAddress: address('Maria Silva', '3 High Street', 'Leeds', 'ls1 4ap', 'GB'),
  Lines: [
    {
      LineNumber: 2,
      Sku: 'tea-earl-250',
      Name: 'Earl Grey loose leaf',
      Variant: {Size: '250g', Colour: ''},
      Qty: 3,
      UnitPrice: 8.5,
      LineTotal: 25.5,
      Discount: {Code: '', Amount: 0},
      Tax: {Rate: 0, Amount: 0},
      Warehouse: 'ldn',
      Weight: 0.27,
      Dimensions: {Length: 120, Width: 80, Height: 60},
      GiftWrap: 'false',
      Personalisation: {Text: '', Font: ''},
      Bundle: [],
    },
    {
      LineNumber: 1,
      Sku: 'gift-set-02',
      Name: 'Tea lover gift set',
      Variant: {Size: 'Large', Colour: 'Teal'},
      Qty: 1,
      UnitPrice: 45,
      LineTotal: 45,
      Discount: {Code: 'GIFT10', Amount: 4.5},
      Tax: {Rate: 20, Amount: 8.1},
      Warehouse: 'man',
      Weight: 1.4,
      Dimensions: {Length: 300, Width: 220, Height: 110},
      GiftWrap: 'true',
      Personalisation: {Text: 'happy birthday maria', Font: 'Serif'},
      Bundle: [
        {Sku: 'tea-earl-50', Qty: 2},
        {Sku: 'mug-teal', Qty: 1},
      ],
    },
  ],
  Promotions: [{Code: 'spring5', Type: 'Fixed', Amount: 5}],
  Payment: {
    Method: 'Card',
    Provider: 'stripe',
    CardBrand: 'Visa',
    Last4: '4242',
    AuthCode: ' a1b2c3 ',
    Amount: 69.1,
    CapturedAt: '2026-03-04T10:23:10Z',
    Instalments: [],
  },
  Shipments: [
    {
      Carrier: 'dpd',
      Service: '24h',
      Tracking: ' 15501234567890 ',
      ShippedAt: '2026-03-05T16:40:00Z',
      Packages: [
        {Weight: 1.92, Items: [{Sku: 'gift-set-02', Qty: 1}, {Sku: 'tea-earl-250', Qty: 2}]},
        {Weight: 0.27, Items: [{Sku: 'tea-earl-250', Qty: 1}]},
      ],
    },
  ],
  Totals: {Subtotal: 70.5, Discount: 9.5, Tax: 8.1, Shipping: 4.95, Grand: 78.55},
  Fraud: {Score: 12, Rules: [{Id: 'velocity', Result: 'pass'}, {Id: 'geo', Result: 'review'}]},
  Meta: {
    Source: 'shopfront',
    UserAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    Ip: '203.0.113.42',
    CreatedAt: '2026-03-04T10:22:00Z',
    UpdatedAt: '2026-03-05T16:41:12Z',
    Tags: ['gift', 'returning-customer'],
  },
};

/** A sample input for `buildMap(copies)`. */
export function buildInput(copies = 1): JsonValue {
  if (copies === 1) return sampleOrder;
  return Object.fromEntries(Array.from({length: copies}, (_, i) => [`Order${i + 1}`, sampleOrder]));
}
