---
title: "RackDown Hugo Integration Proof"
---

# RackDown Hugo Integration Proof

This document proves that an ordinary Hugo static documentation site can contain native fenced RackDown blocks that render to inline SVG at build time.

## Rack Layout

```rackdown
rack "Comms Rack" 12U 19in
12 switch "Core Switch" as core
10 patch "Patch Panel" as patch
core:1 -- patch:1
```

## Unrelated Code Block

```javascript
// Unrelated code blocks continue to render through Hugo's default syntax highlighter
function greet(name) {
  return `Hello, ${name}!`;
}
```

Static documentation continues normally below diagrams.
