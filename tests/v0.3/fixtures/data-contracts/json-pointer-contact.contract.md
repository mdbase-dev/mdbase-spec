---
kind: mdbase.contract
contract_type: record
id: example.typed-contact
version: 1.0.0
record_schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: ["@type", name, "a/b", "a~b"]
    properties:
      "@type":
        const: Contact
      name:
        type: string
      "a/b":
        type: string
      "a~b":
        type: string
---
