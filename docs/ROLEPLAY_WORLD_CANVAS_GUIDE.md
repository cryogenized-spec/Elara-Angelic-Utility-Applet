# Roleplay World Canvas

The **World Canvas** is Elara's persistent setting map for Roleplay Mode.

It gives Elara a place to keep track of the world around the conversation: worlds, buildings, rooms, outdoor areas, places, objects, and other useful locations. The important part is simple: **your story can grow naturally, while the setting stays consistent.**

You do not need to fill in a big form before starting a roleplay. Talk to Elara normally. When a persistent change would be useful, Elara can propose it and the app will ask you to approve it before anything is saved.

## 1. How it works

When Roleplay Mode is enabled, the World Canvas becomes the persistent source of truth for the setting.

Elara can:

- **List** places and entities already in the world.
- **Inspect** one entity to see its details.
- **Create** a new entity.
- **Update** an entity's name, description, type, or parent.
- **Move** an entity somewhere else in the world.
- **Delete** an entity and its children.

Read-only actions can happen normally. Changes that would alter the saved world always stop for a confirmation from you first.

The app also gives Elara the device's **current date, current time, timezone, and weekday** during a conversation. These are live runtime information. They are **not** saved into the World Canvas as permanent facts.

## 2. Start with ordinary language

You do not need to learn special commands.

For example:

> We are in a little cottage in a snowy village. There is a warm bedroom upstairs and a small kitchen downstairs.

That is enough to begin. Elara can decide that the cottage, bedroom, kitchen, and village are useful persistent locations and propose them as world entries.

The important distinction is this:

**Tell Elara what is happening. Let Elara decide what needs to become persistent world information.**

## 3. Step-by-step: building a world

### Step 1 — Turn on Roleplay Mode

Open **Settings → Roleplay** and switch Roleplay Mode on.

The World Canvas will appear.

### Step 2 — Describe the opening scene

Write naturally in the chat. Include the setting, atmosphere, and anything that matters to the scene.

Example:

> I'm sitting in the kitchen of my old farmhouse. It's raining outside, and there is a narrow staircase leading to the upstairs bedroom.

### Step 3 — Let Elara use the Canvas when it helps

Elara can inspect the existing world before deciding where a scene should take place.

When she decides something should be added or changed permanently, the app will show a confirmation card.

### Step 4 — Review the proposed change

Read the confirmation carefully. It tells you what Elara wants to change.

Approve it when it matches what you intended. Decline it when it does not.

### Step 5 — Continue the story

Once the setting exists in the Canvas, keep roleplaying normally. Elara can use the saved locations as anchors for later scenes.

### Step 6 — Use entity references when a location could be ambiguous

Each Canvas entry has a friendly ID such as `bedroom_02` and a separate opaque reference.

Use the copy button beside an entity when you want to target that exact entry. Paste the copied reference into chat when precision matters.

For example:

> Move this scene to `bedroom_02 [world-ref:7f3a91c2e8d44b10]`.

The reference is ordinary plain text so it works reliably with mobile clipboard and PWA behaviour.

## 4. Three examples

### Example A — A simple home

You say:

> My character lives in a small apartment above a bakery. The apartment has a bedroom, kitchen, and living room. The bakery is downstairs.

A sensible Canvas might grow into:

```text
world_01
├── bakery_01
└── apartment_01
    ├── bedroom_01
    ├── kitchen_01
    └── living_room_01
```

You can then roleplay naturally:

> I wake up in the bedroom and head downstairs for coffee.

Elara can inspect the world and understand that the kitchen is inside the apartment and the bakery is downstairs.

### Example B — A larger fantasy setting

You say:

> The story begins in a fortified mountain town. My character has a room at the Red Stag Inn. The town has a market square and an old gate leading into the forest.

The Canvas can represent the relationship between those places instead of treating every sentence as a completely separate location.

Later you might say:

> Let's leave the inn and go toward the forest gate.

Elara can inspect the existing entries and continue from the established setting.

### Example C — Changing the world during play

You say:

> The abandoned greenhouse behind the manor becomes our secret meeting place.

Elara may propose creating a new persistent location under the manor.

The app pauses for confirmation.

You approve it.

From then on, **the greenhouse exists in the saved world** and can be referenced in future scenes.

## 5. Using copied entity references

The Canvas shows friendly IDs because they are easier for people to read. Behind each one is an opaque reference used to remove ambiguity.

The copy button gives you a token in this format:

```text
entity_id [world-ref:16hexcharacters]
```

For example:

```text
bedroom_02 [world-ref:7f3a91c2e8d44b10]
```

Paste that token into a message when you need to make it completely clear which entity you mean.

This is especially useful when there are several similar places:

> Let's go back to `bedroom_02 [world-ref:7f3a91c2e8d44b10]`.

The opaque reference is not shown in the Canvas YAML view. The YAML is intended to stay readable for humans.

## 6. What to look out for

The Canvas is persistent, so treat approved changes as real changes to your story world.

Pay particular attention to:

**Names.** Give places clear names. `bedroom_02` is useful to the system, while `Guest Bedroom` is useful to you.

**Descriptions.** Add details that matter later. A short description such as `Small upstairs room overlooking the snowy street` is much more useful than a vague description.

**Relationships.** Put rooms inside buildings, buildings inside towns, and so on when that relationship is meaningful. The tree structure helps Elara understand where things belong.

**Ambiguity.** When two entities have similar names, use the copied reference token.

**Persistent changes.** Do not approve a proposed change just because it sounds plausible. Approve it when it is actually what you want the world to remember.

## 7. Do's and don'ts

### Do

- Describe scenes naturally.
- Keep important locations reasonably specific.
- Let Elara inspect the existing Canvas before inventing a new place.
- Use copied entity references when precision matters.
- Review confirmation cards before accepting persistent changes.
- Keep the Canvas focused on facts that are useful to future scenes.

### Don't

- Treat the current time or weather as permanent world history unless you explicitly want that as part of the story.
- Create dozens of nearly identical entities for tiny moment-to-moment details.
- Approve a mutation without reading what is being changed.
- Assume a place exists in the Canvas just because it was mentioned once in chat.
- Use the Canvas as a substitute for normal conversation. The story itself still belongs in the chat.

## 8. Recommended way to write roleplay prompts

A good opening usually gives Elara four things:

1. **Where we are.**
2. **What the important surroundings are.**
3. **Who is present.**
4. **What is happening right now.**

For example:

> We are in a remote lodge in a snowy mountain village. The lodge has a common room, kitchen, and two upstairs bedrooms. Elara and I are alone tonight. A storm has just started outside.

That is enough context to begin a scene without turning the conversation into a form-filling exercise.

## 9. A useful mental model

Think of the World Canvas as **the set of places and persistent setting facts that the story can come back to**.

Think of the chat as **what is happening right now**.

Think of confirmation as **the boundary between a temporary idea in conversation and something the world remembers**.

That separation keeps the roleplay flexible without letting the saved world drift silently.

## 10. Quick reference

| Need | What to do |
| --- | --- |
| Start a roleplay | Turn on Roleplay Mode and describe the scene naturally |
| Find an existing place | Let Elara inspect the Canvas |
| Add a persistent place | Describe it naturally; review Elara's proposed change |
| Change a place | Review and approve the proposed mutation |
| Target one exact entity | Copy its reference from the Canvas and paste it into chat |
| See the saved representation | Open **View world YAML** |
| Check current date/time | Read the live runtime context; it is not persistent world data |

## Final recommendation

Start small.

A handful of useful locations is better than a giant directory built before the story begins. Let the world grow as the roleplay gives you a reason to remember something.

That way the Canvas stays useful, readable, and closely tied to the story you are actually telling.
