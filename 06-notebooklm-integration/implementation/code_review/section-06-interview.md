# Code Review Interview — section-06-generator

## Blocker (Auto-fixed)

**null guard missing on tool_input**
- `typeof null === 'object'` is true in JS → null tool_input would crash
- Fixed: `entry.tool_input !== null && typeof entry.tool_input === 'object'`

## Suggestions (Auto-fixed)

**Code fence regex incomplete**
- Changed from `/^```json\s*/i` to `/^```(?:json)?\s*/i`
- Now strips both ` ```json ` and bare ` ``` ` fences

**response.content[0].text unsafe**
- Added `block.type !== 'text'` guard before accessing `.text`
- Falls through to error path if non-text block returned

**Mock missing type field**
- Added `type: 'text'` to `goodApiResponse.content[0]` in test to match real SDK response shape

## Let Go

**Code fence stripping test coverage** — regression risk is low; error path is covered
**Non-text block test** — covered by error path; no test added
