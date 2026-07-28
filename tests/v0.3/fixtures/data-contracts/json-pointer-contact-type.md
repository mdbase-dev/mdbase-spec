---
kind: mdbase.type
name: contact_card
version: 1
schema:
  dialect: json-schema-2020-12
  value:
    type: object
    required: [card]
    properties:
      card:
        type: object
        required: ["@type", label, "a/b", "a~b"]
        properties:
          "@type":
            const: Contact
          label:
            type: string
          "a/b":
            type: string
          "a~b":
            type: string
implements:
  - contract: example.typed-contact
    version: 1.0.0
    fields:
      "/@type": "/card/@type"
      name: "/card/label"
      "/a~1b": "/card/a~1b"
      "/a~0b": "/card/a~0b"
---
