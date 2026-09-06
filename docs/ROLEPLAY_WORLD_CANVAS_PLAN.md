# Roleplay World Canvas

## Purpose

Replace the legacy Roleplay environment form with one persistent, user-visible World Canvas that Elara can inspect and mutate through the existing application tool boundary.

## Authority model

There is one Roleplay world state. It is persisted locally as a typed world object and rendered as YAML for human-readable inspection.

The AI does not edit a YAML string directly. It calls the existing canonical tool executor with structured arguments. The executor validates the request, applies the existing confirmation policy for persistent mutations, and only then invokes the single Roleplay world handler set.

There is no secondary AI policy, permission model, personality, or shadow state machine.

## Entity identity

Each entity has two references:

- a human-friendly stable id such as `bedroom_02`;
- a hidden-from-canvas opaque 16-hex `ref` generated from a SHA-256 digest.

The friendly id is used for ordinary natural-language references. The opaque ref is included in the copyable reference token (`bedroom_02 [world-ref:xxxxxxxxxxxxxxxx]`) so a pasted reference can identify an entity unambiguously.

The visible YAML deliberately omits the opaque ref. The application and AI tool results retain it.

## World representation

```yaml
world:
  id: "world_01"
  name: "The Old House"
  description: "A weathered two-storey house..."
  locations:
    house_01:
      type: "building"
      name: "The Old House"
      parent: ""
      description: "A weathered two-storey house..."
    bedroom_02:
      type: "room"
      name: "Upstairs Bedroom"
      parent: "house_01"
      description: "A narrow bedroom overlooking the garden..."
```

The YAML is a view/export format, not a second persistence authority.

## Directory tree

The UI derives a compact recursive directory tree from `parentId` relationships. Creating a new entity does not create a new form. The tree grows as data, not as UI structure.

Each entity exposes a copy-reference action so the user can paste an exact world reference into chat.

## AI tools

The existing application registry exposes:

- `roleplay_setting.list`
- `roleplay_setting.inspect`
- `roleplay_setting.create`
- `roleplay_setting.update`
- `roleplay_setting.move`
- `roleplay_setting.delete`

Read operations do not require confirmation. Persistent mutations default to **Always Ask** through the existing confirmation boundary.

The confirmation card is an interception point only. It does not independently decide what the AI should do.

## Runtime context

Real-world time is not persisted in the World Canvas. Every conversational tool turn receives live device context:

- local date;
- local time;
- weekday;
- timezone.

When Roleplay Mode is active, the application context instructs Elara to maintain a coherent physical setting, use the World Canvas as authoritative persistent context, use the current runtime clock dynamically, and use italics for physical action/scene narration.

## Mermaid

Mermaid is intentionally deferred to a visualization overlay. The World Canvas remains authoritative. Future Mermaid views will be derived from the entity/parent relationships and must not become a second editable world model.

## Migration

Legacy Roleplay environment fields are read only as a one-time migration source when no World Canvas exists. New Roleplay UI does not expose the legacy preset/time/weather/environment form.
