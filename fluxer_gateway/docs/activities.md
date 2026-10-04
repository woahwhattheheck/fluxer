# Gateway activities

Clients can include an optional `activities` array in the presence object sent
with `IDENTIFY` and `PRESENCE_UPDATE`. Existing clients can omit the field.

```json
{
  "status": "online",
  "afk": false,
  "mobile": false,
  "activities": [
    {
      "name": "Example game",
      "type": 0,
      "application_id": "123456789",
      "details": "In a match",
      "state": "Playing",
      "timestamps": {"start": 1791095400},
      "assets": {"large_image": "game-art", "large_text": "Example game"}
    }
  ]
}
```

## Input and clearing

Activities belong to the authenticated session. An omitted field preserves that
session's current activities during updates and a healthy resume; a new session
starts with none. `null` and `[]` explicitly clear the list. A full reconnect
restores the latest session state, including an explicit clear. The asynchronous
healthy-resume request carries no activity snapshot, so a delayed resume cannot
restore activities cleared by a newer update.

The Gateway examines at most the first ten array entries, including malformed
entries. Each accepted activity requires a nonempty `name` and an integer `type`
from 0 through 5. Invalid required fields drop the activity. Invalid optional
fields are omitted, as are unknown fields at every nesting level. A malformed
top-level value normalizes to an empty list.

Supported optional fields are:

| Field | Accepted value |
| --- | --- |
| `application_id` | Canonical positive signed-64-bit snowflake string |
| `details`, `state` | Text up to 128 JavaScript UTF-16 code units |
| `timestamps.start`, `timestamps.end` | Nonnegative integer at most `2^53 - 1` |
| `assets.large_image`, `assets.small_image` | Text up to 256 UTF-16 code units |
| `assets.large_text`, `assets.small_text` | Text up to 128 UTF-16 code units |

`name` also has the 128-unit limit. Text must be valid UTF-8. Limits match the
client schema's JavaScript string-length convention, including supplementary
Unicode characters. Accepted strings are detached from the decoded input frame
so retaining a short activity cannot retain a much larger frame binary.

Timestamp integers are passed through unchanged; the Gateway does not guess or
convert time units. The rich-presence client contract uses Unix seconds.
Local-only `data:`, `blob:` and `fluxer-rpc-art://` asset references are removed.
Other bounded image references are retained; the Gateway does not fetch images.

## Visibility and delivery

Only sessions with `online`, `idle` or `dnd` status contribute activities. An
invisible or offline session contributes none, even when another session makes
the same user visible. Identical activities across visible sessions are
deduplicated in a stable order, and the combined list is bounded to ten entries.

Outbound presence payloads include `activities`, using `[]` when there are none.
Offline and invisible payloads always clear it. Presence termination and the
existing loss-of-subscription notification also send an explicit empty list.
Existing recipient, friendship, community and channel visibility rules apply.

Activity-only changes participate in presence broadcast deduplication, cached
community replay, member-list refresh and reconciliation. They do not generate
an additional status-only `SESSIONS_REPLACE` event. The client consumes the
activities field through its existing presence update path.

This server contract supports the coordinated client activity implementation;
it does not by itself add desktop process detection, RPC ingestion, mobile UI
or application-catalog discovery.
