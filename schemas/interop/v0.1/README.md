# Interoperability profile schemas

These schemas define mdbase event/action interoperability profile `0.1`.
`profile.schema.json` contains the shared definitions and complete envelope
union. The smaller files are stable entry points for one envelope or
declaration.

Implementations preload the profile schema before compiling an entry-point
schema. They never fetch schema references from the network.
