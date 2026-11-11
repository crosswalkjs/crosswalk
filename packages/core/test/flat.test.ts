import { describe, expect, it } from "vitest";
import { createTransform, inferCsvSchema, listFields, readFlatFile, writeFlatFile, type MapDocument, type Schema } from "../src/index.js";

const payments: Schema = {
  type: "object",
  flat: { format: "csv" },
  properties: {
    rows: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", flat: { name: "Payment ID" } },
          amount: { type: "number" },
          paid: { type: "boolean" },
          note: { type: "string" },
        },
      },
    },
  },
};

const ledger: Schema = {
  type: "object",
  flat: { format: "fixed", lineEnding: "\r\n" },
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          code: { type: "string", flat: { width: 6 } },
          amount: { type: "number", flat: { width: 10, pad: "0", decimals: 2 } },
          memo: { type: "string", flat: { width: 12 } },
        },
      },
    },
  },
};

describe("CSV", () => {
  it("reads by the schema: header names in any order, quoting, line breaks, types and empty cells", () => {
    const csv = '﻿note,Payment ID,amount,paid\r\n"Rent, May",P-1,950.5,true\r\n"Says ""hi""\nover two lines",P-2,12,0\r\n,P-3,,\r\n';
    expect(readFlatFile(csv, payments)).toEqual({
      rows: [
        { id: "P-1", amount: 950.5, paid: true, note: "Rent, May" },
        { id: "P-2", amount: 12, paid: false, note: 'Says "hi"\nover two lines' },
        { id: "P-3" },
      ],
    });
  });

  it("reads without a schema, every value as text", () => {
    expect(readFlatFile("a;b\n1;2\n", { type: "object", flat: { delimiter: ";" } })).toEqual({ rows: [{ a: "1", b: "2" }] });
    expect(readFlatFile("x,y\n1,2")).toEqual({ rows: [{ x: "1", y: "2" }] });
  });

  it("writes in the schema's order, with a header, quoting where it has to", () => {
    expect(writeFlatFile({ rows: [{ amount: 950.5, id: "P-1", note: "Rent, May", paid: true }, { id: "P-2", note: ' "padded" ' }] }, payments)).toBe(
      'Payment ID,amount,paid,note\nP-1,950.5,true,"Rent, May"\nP-2,,," ""padded"" "\n',
    );
  });

  it("makes a schema from a sample, keeping codes with leading zeros as text", () => {
    const schema = inferCsvSchema("sku;qty;price;postcode;active\nA1;2;4.5;01234;true\nB2;10;8;99999;false\n");
    expect(schema.flat).toEqual({ format: "csv", delimiter: ";" });
    expect(listFields(schema).map((f) => `${f.path}:${f.schema.type}`)).toEqual(["rows[]:object", "rows[].sku:string", "rows[].qty:integer", "rows[].price:number", "rows[].postcode:string", "rows[].active:boolean"]);
  });
});

describe("fixed-width files", () => {
  const text = "AB12  0000095050Rent May    \r\nZZ9   -000000120Refund      \r\n";

  it("reads columns by width, with implied decimals", () => {
    expect(readFlatFile(text, ledger)).toEqual({
      entries: [
        { code: "AB12", amount: 950.5, memo: "Rent May" },
        { code: "ZZ9", amount: -1.2, memo: "Refund" },
      ],
    });
  });

  it("writes them back the same", () => {
    expect(writeFlatFile(readFlatFile(text, ledger), ledger)).toBe(text);
  });

  it("refuses a value too wide for its column, rather than cut it short", () => {
    expect(() => writeFlatFile({ entries: [{ code: "TOOLONG1" }] }, ledger)).toThrow('"TOOLONG1" is too wide for column "code", which takes 6');
  });
});

describe("through a map", () => {
  it("maps a CSV file to a fixed-width one", () => {
    const map: MapDocument = {
      version: 1,
      source: payments,
      target: ledger,
      nodes: [{ id: "upper", operator: "text.upper" }],
      links: [
        { from: { source: "rows[].id" }, to: { target: "entries[].code" } },
        { from: { source: "rows[].amount" }, to: { target: "entries[].amount" } },
        { from: { source: "rows[].note" }, to: { node: "upper", input: 0 } },
        { from: { node: "upper" }, to: { target: "entries[].memo" } },
      ],
      loops: [{ source: "rows[]", target: "entries[]" }],
    };
    const out = createTransform(map)(readFlatFile("Payment ID,amount,paid,note\nP-1,950.5,true,Rent May\n", payments));
    expect(writeFlatFile(out, ledger)).toBe("P-1   0000095050RENT MAY    \r\n");
  });
});

describe("files with several kinds of line", () => {
  const statement: Schema = {
    type: "object",
    flat: { format: "csv", delimiter: "|" },
    properties: {
      header: { type: "object", flat: { tag: "H" }, properties: { date: { type: "string" }, account: { type: "string" } } },
      payments: { type: "array", items: { type: "object", flat: { tag: "D" }, properties: { id: { type: "string" }, amount: { type: "number" } } } },
      trailer: { type: "object", flat: { tag: "T" }, properties: { count: { type: "integer" }, total: { type: "number" } } },
    },
  };
  const text = "H|2026-03-02|ACC-1\nD|P-1|100.5\nD|P-2|50\nT|2|150.5\n";

  it("reads each kind of line by its tag, a record for one and a list for many", () => {
    expect(readFlatFile(text, statement)).toEqual({
      header: { date: "2026-03-02", account: "ACC-1" },
      payments: [
        { id: "P-1", amount: 100.5 },
        { id: "P-2", amount: 50 },
      ],
      trailer: { count: 2, total: 150.5 },
    });
    expect(writeFlatFile(readFlatFile(text, statement), statement)).toBe(text);
  });

  // A bank-style file: a file header, batches each with a header, entries and a trailer, and a file trailer.
  const bank: Schema = {
    type: "object",
    flat: { format: "fixed" },
    properties: {
      file: { type: "object", flat: { tag: "FH" }, properties: { bank: { type: "string", flat: { width: 6 } } } },
      batches: {
        type: "array",
        items: {
          type: "object",
          flat: { tag: "BH" },
          properties: {
            name: { type: "string", flat: { width: 8 } },
            entries: { type: "array", items: { type: "object", flat: { tag: "EN" }, properties: { payee: { type: "string", flat: { width: 6 } }, pence: { type: "number", flat: { width: 6, pad: "0", decimals: 2 } } } } },
            control: { type: "object", flat: { tag: "BT" }, properties: { count: { type: "integer", flat: { width: 3, pad: "0" } } } },
          },
        },
      },
      end: { type: "object", flat: { tag: "FT" }, properties: { batches: { type: "integer", flat: { width: 3, pad: "0" } } } },
    },
  };
  const file = ["FHBANK01", "BHPAYROLL ", "ENANA   001250", "ENBEN   000099", "BT002", "BHSUPPLY  ", "ENACME  010000", "BT001", "FT002", ""].join("\n");

  it("reads nested kinds of line: each batch's entries belong to the batch above them", () => {
    expect(readFlatFile(file, bank)).toEqual({
      file: { bank: "BANK01" },
      batches: [
        { name: "PAYROLL", entries: [{ payee: "ANA", pence: 12.5 }, { payee: "BEN", pence: 0.99 }], control: { count: 2 } },
        { name: "SUPPLY", entries: [{ payee: "ACME", pence: 100 }], control: { count: 1 } },
      ],
      end: { batches: 2 },
    });
    expect(writeFlatFile(readFlatFile(file, bank), bank)).toBe(file);
  });

  it("refuses a line that isn't any kind the file has", () => {
    expect(() => readFlatFile("H|2026-03-02|ACC-1\nX|what\n", statement)).toThrow("Line 2 isn't a kind of line this file has");
  });

  it("works through a map: a trailer counting and totalling the details", () => {
    const map: MapDocument = {
      version: 1,
      source: statement,
      target: statement,
      nodes: [
        { id: "count", operator: "aggregate.count", scope: "payments[]" },
        { id: "total", operator: "aggregate.sum", scope: "payments[]" },
      ],
      links: [
        { from: { source: "header" }, to: { target: "header" } },
        { from: { source: "payments[].id" }, to: { target: "payments[].id" } },
        { from: { source: "payments[].amount" }, to: { target: "payments[].amount" } },
        { from: { source: "payments[].id" }, to: { node: "count", input: 0 } },
        { from: { source: "payments[].amount" }, to: { node: "total", input: 0 } },
        { from: { node: "count" }, to: { target: "trailer.count" } },
        { from: { node: "total" }, to: { target: "trailer.total" } },
      ],
      loops: [{ source: "payments[]", target: "payments[]" }],
    };
    const out = createTransform(map)(readFlatFile("H|2026-03-02|ACC-1\nD|P-1|100.5\nD|P-2|50\nT|9|9\n", statement));
    expect(writeFlatFile(out, statement)).toBe(text);
  });
});

describe("repeating groups within a line", () => {
  // HL7 v2 style: fields split by |, a field repeated with ~, each repeat split into components with ^.
  const hl7: Schema = {
    type: "object",
    flat: { format: "csv", delimiter: "|" },
    properties: {
      patient: {
        type: "object",
        flat: { tag: "PID" },
        properties: {
          set: { type: "integer" },
          external: { type: "string" },
          identifiers: {
            type: "array",
            flat: { delimiter: "~" },
            items: { type: "object", flat: { delimiter: "^" }, properties: { id: { type: "string" }, check: { type: "string" }, scheme: { type: "string" }, authority: { type: "string" } } },
          },
          name: { type: "string" },
        },
      },
    },
  };

  it("reads a field's repeats, each split into its parts, and writes them back", () => {
    const text = "PID|1||123^^^HOSP~456^^^LAB|SMITH\n";
    expect(readFlatFile(text, hl7)).toEqual({
      patient: { set: 1, identifiers: [{ id: "123", authority: "HOSP" }, { id: "456", authority: "LAB" }], name: "SMITH" },
    });
    expect(writeFlatFile(readFlatFile(text, hl7), hl7)).toBe(text);
  });

  const order: Schema = {
    type: "object",
    flat: { format: "fixed" },
    properties: {
      orders: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", flat: { width: 6 } },
            lines: { type: "array", items: { type: "object", properties: { sku: { type: "string", flat: { width: 4 } }, qty: { type: "integer", flat: { width: 3, pad: "0" } } } } },
          },
        },
      },
    },
  };

  it("reads fixed-width items to the end of the line", () => {
    const text = "ORD001A100003B200001C300010\nORD002A100001\n";
    expect(readFlatFile(text, order)).toEqual({
      orders: [
        { id: "ORD001", lines: [{ sku: "A100", qty: 3 }, { sku: "B200", qty: 1 }, { sku: "C300", qty: 10 }] },
        { id: "ORD002", lines: [{ sku: "A100", qty: 1 }] },
      ],
    });
    expect(writeFlatFile(readFlatFile(text, order), order)).toBe(text);
  });

  it("with a count, skips blank slots when reading, pads them when writing, and refuses too many", () => {
    const slots: Schema = structuredClone(order);
    const lines = slots.properties!.orders!.items!.properties!.lines!;
    lines.flat = { count: 3 };
    slots.properties!.orders!.items!.properties!.total = { type: "integer", flat: { width: 4, pad: "0" } };
    const text = `ORD002A100001${" ".repeat(14)}0001\n`;
    expect(readFlatFile(text, slots)).toEqual({ orders: [{ id: "ORD002", lines: [{ sku: "A100", qty: 1 }], total: 1 }] });
    expect(writeFlatFile(readFlatFile(text, slots), slots)).toBe(text);
    const four = { orders: [{ id: "ORD003", lines: [1, 2, 3, 4].map((qty) => ({ sku: "A100", qty })) }] };
    expect(() => writeFlatFile(four, slots)).toThrow('"lines" has 4 items, more than the 3 its line has room for');
  });

  it("refuses a group that takes the rest of the line when columns follow it", () => {
    const wrong: Schema = structuredClone(order);
    wrong.properties!.orders!.items!.properties!.total = { type: "integer", flat: { width: 4 } };
    expect(() => readFlatFile("ORD001A100003\n", wrong)).toThrow('Repeating group "lines" takes the rest of the line');
  });

  it("in CSV without a delimiter of its own, takes its items from the fields that follow; single values too", () => {
    const csv: Schema = {
      type: "object",
      flat: { format: "csv", header: false },
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              codes: { type: "array", flat: { count: 2 }, items: { type: "string" } },
              lines: { type: "array", items: { type: "object", properties: { sku: { type: "string" }, qty: { type: "integer" } } } },
            },
          },
        },
      },
    };
    const text = "P-1,X,,A100,3,B200,1\n";
    expect(readFlatFile(text, csv)).toEqual({ rows: [{ id: "P-1", codes: ["X"], lines: [{ sku: "A100", qty: 3 }, { sku: "B200", qty: 1 }] }] });
    expect(writeFlatFile(readFlatFile(text, csv), csv)).toBe(text);
  });
});

describe("record columns", () => {
  it("in CSV, splits one field into its parts, as HL7 splits a name with ^", () => {
    const schema: Schema = {
      type: "object",
      flat: { format: "csv", delimiter: "|", header: false },
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "object", flat: { delimiter: "^" }, properties: { family: { type: "string" }, given: { type: "string" }, middle: { type: "string" } } },
              born: { type: "string" },
            },
          },
        },
      },
    };
    const text = "P-1|SMITH^JOHN|19800101\nP-2||19900101\n";
    expect(readFlatFile(text, schema)).toEqual({
      rows: [
        { id: "P-1", name: { family: "SMITH", given: "JOHN" }, born: "19800101" },
        { id: "P-2", born: "19900101" },
      ],
    });
    expect(writeFlatFile(readFlatFile(text, schema), schema)).toBe(text);
  });

  it("in fixed-width, reads its parts one after another", () => {
    const schema: Schema = {
      type: "object",
      flat: { format: "fixed" },
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", flat: { width: 3 } },
              amount: { type: "object", properties: { pounds: { type: "integer", flat: { width: 4, pad: "0" } }, pence: { type: "integer", flat: { width: 2, pad: "0" } } } },
            },
          },
        },
      },
    };
    const text = "P-1001299\n";
    expect(readFlatFile(text, schema)).toEqual({ rows: [{ id: "P-1", amount: { pounds: 12, pence: 99 } }] });
    expect(writeFlatFile(readFlatFile(text, schema), schema)).toBe(text);
  });
});

describe("nested parts, and EDI", () => {
  it("reads HL7 sub-components: a part that's a record split by &", () => {
    const schema: Schema = {
      type: "object",
      flat: { format: "csv", delimiter: "|", header: false },
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              ids: {
                type: "array",
                flat: { delimiter: "~" },
                items: {
                  type: "object",
                  flat: { delimiter: "^" },
                  properties: {
                    id: { type: "string" },
                    authority: { type: "object", flat: { delimiter: "&" }, properties: { name: { type: "string" }, oid: { type: "string" }, kind: { type: "string" } } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const text = "P-1|123^HOSP&1.2.3&ISO~456^LAB\n";
    expect(readFlatFile(text, schema)).toEqual({
      rows: [{ id: "P-1", ids: [{ id: "123", authority: { name: "HOSP", oid: "1.2.3", kind: "ISO" } }, { id: "456", authority: { name: "LAB" } }] }],
    });
    expect(writeFlatFile(readFlatFile(text, schema), schema)).toBe(text);
  });

  it("reads a fixed-width group inside a group's items, given a count", () => {
    const schema: Schema = {
      type: "object",
      flat: { format: "fixed" },
      properties: {
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", flat: { width: 2 } },
              lines: {
                type: "array",
                items: { type: "object", properties: { sku: { type: "string", flat: { width: 2 } }, sizes: { type: "array", flat: { count: 2 }, items: { type: "string", flat: { width: 1 } } } } },
              },
            },
          },
        },
      },
    };
    const text = "O1A1SMB2L \n";
    expect(readFlatFile(text, schema)).toEqual({ rows: [{ id: "O1", lines: [{ sku: "A1", sizes: ["S", "M"] }, { sku: "B2", sizes: ["L"] }] }] });
    expect(writeFlatFile(readFlatFile(text, schema), schema)).toBe(text);
  });

  it("reads EDIFACT: segments ended by ', parts by :, and ? releasing a separator", () => {
    const schema: Schema = {
      type: "object",
      flat: { format: "csv", delimiter: "+", terminator: "'", release: "?" },
      properties: {
        header: { type: "object", flat: { tag: "UNH" }, properties: { reference: { type: "string" }, type: { type: "object", flat: { delimiter: ":" }, properties: { name: { type: "string" }, version: { type: "string" } } } } },
        names: { type: "array", items: { type: "object", flat: { tag: "NAD" }, properties: { role: { type: "string" }, name: { type: "string" } } } },
      },
    };
    const text = "UNH+1+ORDERS:D'\nNAD+BY+ACME?+CO?'S'\nNAD+SU+50?% OFF'\n";
    const read = readFlatFile(text, schema);
    expect(read).toEqual({
      header: { reference: "1", type: { name: "ORDERS", version: "D" } },
      names: [{ role: "BY", name: "ACME+CO'S" }, { role: "SU", name: "50?% OFF".replace("?", "") }],
    });
    expect(writeFlatFile(read, schema)).toBe("UNH+1+ORDERS:D'NAD+BY+ACME?+CO?'S'NAD+SU+50% OFF'");
  });

  it("reads X12: segments ended by ~, with no quotes", () => {
    const schema: Schema = {
      type: "object",
      flat: { format: "csv", delimiter: "*", terminator: "~", lineEnding: "\n" },
      properties: { lines: { type: "array", items: { type: "object", flat: { tag: "PO1" }, properties: { line: { type: "integer" }, qty: { type: "integer" }, note: { type: "string" } } } } },
    };
    const text = 'PO1*1*10*"big"~\nPO1*2*5~\n';
    expect(readFlatFile(text, schema)).toEqual({ lines: [{ line: 1, qty: 10, note: '"big"' }, { line: 2, qty: 5 }] });
    expect(writeFlatFile(readFlatFile(text, schema), schema)).toBe(text);
  });
});

describe("CSV columns with a width", () => {
  it("pads them when writing and trims them when reading, as X12's envelope has, blank ones included", () => {
    const schema: Schema = {
      type: "object",
      flat: { format: "csv", delimiter: "*", terminator: "~", lineEnding: "\n" },
      properties: {
        envelope: {
          type: "object",
          flat: { tag: "ISA" },
          properties: { qualifier: { type: "string" }, password: { type: "string", flat: { width: 10 } }, sender: { type: "string", flat: { width: 15 } } },
        },
      },
    };
    const text = "ISA*00*          *SENDER         ~\n";
    expect(readFlatFile(text, schema)).toEqual({ envelope: { qualifier: "00", sender: "SENDER" } });
    expect(writeFlatFile(readFlatFile(text, schema), schema)).toBe(text);
  });
});
