---
description: Query the DevNeural graph with a natural language voice command
---

Run a voice query against the DevNeural graph:

```bash
node "$(dirname "$(realpath "${BASH_SOURCE[0]:-$0}")")/../../05-voice-interface/dist/index.js" "$ARGUMENTS"
```

Or from the DevNeural root:

```bash
node 05-voice-interface/dist/index.js $ARGUMENTS
```
