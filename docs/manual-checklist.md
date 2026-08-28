# Manual QA checklist

Run `npm run dev`, open two `http://localhost:5173` windows (two accounts: citizen + cop).

1. Registration: enter a new email and password (min 4 chars) — the account is created instantly, the character screen opens.
2. Create a second character on the same account (different nick and role) — appears in the list; character progress is independent.
3. Re-login: close the tab, enter the same email+password and pick the previous character — cash, safe and apartment are intact.
4. Wrong password for an existing email — "Wrong password" error, no entry.
5. Concurrent login of the same account (another window, same email+password) — "This account is already in game" error.
6. Character deletion: "Delete" button with confirmation — the character disappears, progress is lost forever.
7. Citizen login — spawn at the hospital, HUD shows $500.
8. WASD moves, Shift runs, the character doesn't pass through buildings.
9. Approach a car — "E — enter car" hint; driving (W/S throttle/brake, A/D steering); hitting a building stops the car.
10. Drive to the warehouse (orange marker) — "E — take cargo", banner with destination and timer; delivery pays by distance ($60 + $0.4 per meter).
11. Punch the second player — their HP drops; kill → they disappear, respawn after 3 s, killer gets a "WANTED" banner.
12. The cop sees a red marker above wanted players; stand close for 3 s → criminal jailed (banner with timer), released at the station after 2 min; cop gets bonus and salary (after 5 min).
13. At an apartment door (yellow marker) — "E — rent $100"; HUD shows the apartment; at the door again the safe opens — deposit/withdraw work.
14. Kill a player — they respawn at the hospital (safe zone), safe money is kept, part of the cash drops as a pickup at the death spot — anyone can grab it.
15. Restart the server, log in with the same email+password, pick the same character — cash, safe and apartment are intact.
16. DevTools → Offline 3 s → Online — "Connection lost…" overlay, the game continues without re-login (transparent reconnect, 10 s window).
17. Hit a player — "−20" floats above the victim, swing animation plays; the other player has an HP bar overhead; holding RMB centers the aim.
18. Buy a bat — a brown block appears in hand; firing a pistol shows a tracer, muzzle flash and recoil.
19. Driving: front wheels steer with A/D, all wheels spin; running over a player deals damage and knockback ("−N"), at low speed only a push; ramming pushes cars apart.
20. Driving into the fenced hospital/police zone turns you back; inside the zone punches and shots deal no damage (both ways).
21. Labeled pickups (Bat/Pistol/Rifle/Ammo) rotate around the map — pickup on touch, respawn after ~30 s.
22. Zombies (green, "Zombie" label) chase and attack; a killed zombie resurrects at the cemetery; no wanted level for zombies; they stay out of safe zones.
23. Open shop/safe — buttons respond immediately (no alt-tab needed); the dialog closes when you walk away.
24. Get wanted with active cargo — "WANTED" and "Cargo → Port" banners are both visible (two lines).
25. Minimap: visible bottom-right; the arrow rotates with the player; roads/buildings match the city; POIs are in place.
26. Minimap: the car you exited is marked yellow; if it's stolen the mark disappears.
27. Minimap: with cargo, the order destination is marked red.
28. Full map: M toggles, Esc closes; wheel zoom, drag to pan; POI labels are readable; WASD is ignored while open.
29. Phone: P toggles; unread badge appears on an incoming SMS (sent from the second client); "SMS from …" toast.
30. SMS: dialogs → thread; a message reaches the second client; history survives re-login; offline players get it on login (badge).
31. Bank: transfer to the second client — both balances update; transfer to an offline nick is credited on their login; insufficient funds — error toast.
32. Job: on foot "Take order" — "You need to be in a car" toast; in a car the order is assigned and the destination shows on the minimap; delivery pays as before; "Cancel" drops the order.
33. Phone and map: opening one closes the other; while open, canvas clicks are ignored; closing via P/M/Esc restores control.
