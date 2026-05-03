# Code Review: section-01-foundation

## Summary

Scaffold is correct and all smoke tests pass. One false-positive CRITICAL finding, one valid MEDIUM finding, and a LOW finding. No user interview needed — both fixes are auto-applies.

---

## Findings

### CRITICAL (FALSE POSITIVE): server.ts callback API
Reviewer claimed Fastify v5 removed the callback `listen()` overload. **Incorrect.**
Fastify 5.8.4 types at `node_modules/fastify/types/instance.d.ts:170` explicitly declare:
```ts
listen(opts: FastifyListenOptions, callback: (err: Error | null, address: string) => void): void;
```
Server started and logged `"Server listening at http://127.0.0.1:3747"` during smoke test. **No action.**

### HIGH (NOT AN ISSUE): Missing subdirectories
Reviewer claims subdirectories are absent. They are absent from the git diff because git doesn't track empty directories — this is expected behavior. The directories exist on disk (created via mkdir -p). **No action.**

### MEDIUM → AUTO-FIX: PORT validation logic
Current logic mixes concerns and has dead-code guards:
```ts
if (!Number.isInteger(portNum) || portRaw.trim() === '' || portRaw.includes('.'))
```
- `portRaw.trim() === ''` only triggers if `PORT=''` explicitly, and in that case `Number('') = 0` which IS an integer but fails range check — so the guard is partially redundant
- `portRaw.includes('.')` rejects `'3.0'` but `Number.isInteger(Number('3.0')) = false` already catches this

**Fix:** Use a regex `/^\d+$/.test(portRaw.trim())` to cleanly identify non-integer strings before calling `Number()`. Trim whitespace first so `PORT=' 3 '` is coerced cleanly rather than silently accepted.

### LOW → AUTO-FIX: tsconfig extra fields
`declaration: true` and `declarationMap: true` are unnecessary for a standalone server binary (never imported as a library). Remove them. Keep `sourceMap: true` for debugging utility.
