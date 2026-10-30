# DAZZA Social Rooms: operations and audit notes

## Room lifecycle
- Rooms are public to authenticated DAZZA members and expire 24 hours after creation.
- Voice rooms are limited to six members. Watch and quiz rooms can contain up to twelve members.
- Supabase serializes membership changes by locking the room row and counts heartbeat-active memberships before accepting joins. This prevents concurrent joins from exceeding the stored room capacity.
- The browser renews the member heartbeat every 25 seconds. Members older than three minutes are treated as inactive, so a closed tab does not reserve a seat forever.
- Room owners close the room when they explicitly leave or navigate away. Other members remove their own membership on exit.

## Realtime and privacy
- Room chat rows are only readable and writable by a current room member.
- Broadcast and Presence channels are private and authorized by the current room membership.
- Security-definer helpers live in the non-exposed private schema, use an empty search_path, verify auth.uid(), and have execution privileges limited to authenticated clients where needed.
- Room chat is limited to six messages per user per room per ten seconds.
- Room data tables have Row Level Security enabled and explicit Data API grants.

## Watch parties
- Watch parties accept YouTube video IDs or links from YouTube official hostnames only.
- The official YouTube embedded player is used. DAZZA synchronizes the host playback state; it does not re-host, copy, or re-broadcast video content.
- Each participant must be able to view the selected YouTube video. Some videos disallow embedding.

## Voice rooms: known limitation
- Audio currently uses a peer-to-peer WebRTC mesh with STUN discovery and a six-person ceiling.
- There is no TURN relay service configured yet. Some NATs, corporate networks, mobile carriers, or restrictive firewalls will block direct peer connections even when STUN is available.
- Before calling voice rooms reliable for general public use, provision a TURN provider and issue short-lived credentials from a secure backend. Do not place a permanent TURN username/password in browser source or public Vite environment variables.
- Real-world acceptance testing still needs at least two authenticated accounts on separate devices and networks, with microphone permission granted over HTTPS.

## Challenges
- Challenge creation, joining, and self-reported completion are stored in Supabase.
- The points displayed on challenges are cosmetic only. They are not a currency, prize balance, or verified achievement until a trusted verification/leaderboard system is implemented.

## Release checklist
1. Keep the GitHub Actions test and Vite production build green.
2. Smoke-test sign-in, room create/join/leave, chat, and expired-room rejection.
3. Test watch synchronization with two separate browsers and a YouTube video that permits embedding.
4. Test microphone permission, mute, disconnect/reconnect, and peer audio on different networks.
5. Deploy a single production build after the Vercel daily deployment-operation limit has reset, then test the actual production domain.