---
kind: mdbase.contract
id: example.typed-contact
version: 1.0.0
schema:
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
