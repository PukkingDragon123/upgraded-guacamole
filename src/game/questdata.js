// Quest content (quests16, OWNER: Lab+Quests agent): the side stories of every chapter, the milestones and the pool
// of "Today's orders". The engine lives in src/game/quests.js; this file is data only (no imports).
//
//   SIDE_STORIES {chId: [quest]}   optional chapter quests, told by the chapter's NPCs. They open with the chapter
//                                  (or once `after` is done), track in parallel and are CLAIMED in the Quest Log; the
//                                  chapter's main line (CHAPTERS[].quests) still decides when the next ocean opens.
//                                  Aero is in (OS)cean units: quests.js scales it by the chapter ocean's OCEAN_VALUE.
//                                  `online: true` = needs multiplayer (always optional, never on the order board).
//   MILESTONES [quest + {line, tier}]  lifetime goals in lines of tiers ({t: 'total', k, n} objectives mostly).
//   MILESTONE_LINES [{id, name, icon}]  display order + names of the milestone lines.
//   ORDER_POOL [{id, giver, title, text, minCh, needs?, k, make(c, rng) -> [objectives]}]  "Today's orders" templates.
//     c = {ch (0..6), oceans: [unlocked ocean ids], here (current ocean), mat (a chapter material id)}.
//   DAILY_AERO [per chapter index]  base Aero of one order (x the template's k); ORDER_MATS [per chapter] materials.
//
// Objective vocabulary (see quests.js for how each one is counted):
//   catch {n, rarity?, biome?, species?, zone?, weather? (id | [ids] | 'any' = not the ocean's calm default),
//          time? ('night' | 'day' | 'dusk'), bait? (bait id | 'any' | 'app' | 'custom'), trophy?, giant?, shiny?,
//          mutant?, flawless? (no weak / fizzled / backfired zap, at least one PERFECT one), party? (online friends)}
//   zap {n} PERFECT shocks   feed {n}   build {n} tank placements   hatch {n}   evolve {n}   collect {n} tank Aero
//   tankFish {n} fish in the tank now   gearLv {id, lv} tank gear level   dress {n} outfit changes   box {n, biome?}
//   labDone {n} research finished from now on   total {k, n} lifetime (k: caught species aero research bosses zaps
//   flawless chests fed built crafted oceans released shiny mutant giant cosmetics rods orders quests boxes hatched
//   zones)   online (multiplayer, optional)   + the older ones: keep release bait craft {cat?} equip species {biome?}
//   research tank boat visit depth aero chest have dest craftRod rodUp tackle boss.

const S = (id, giver, title, text, objectives, reward, o = {}) => ({ id, giver, title, text, objectives, reward, ...o });

// ------------------------------------------------------------------ side stories
export const SIDE_STORIES = {
  ch1: [
    S('s1_wifi', 'seal', 'Signal Strength', "A Wi-Fish! If we catch one, maybe I'll finally get one bar of signal down here!", [{ t: 'catch', n: 1, species: 'loafer' }], { aero: 3, items: { fish_scale: 2 } }),
    S('s1_googly', 'seal', 'Judgy Fish', "That Side-Eye Fish keeps judging my flippers. Catch it so we can talk it out like grown-up sea creatures.", [{ t: 'catch', n: 1, species: 'googly' }], { aero: 3, items: { shell: 2 } }),
    S('s1_crab', 'fizz', 'Double Trouble', "Double-Click Crabs! Click once: it waves. Click twice: it opens a new window. Bring me two specimens!", [{ t: 'catch', n: 2, species: 'clickcrab' }], { aero: 4, items: { kelp_fibre: 2 } }),
    S('s1_feed', 'seal', 'Dinner Bell', "Fish get the munchies too! Sprinkle some food in the tank. Three snacks, then tummy rubs!", [{ t: 'feed', n: 3 }], { aero: 3, items: { shell: 2 } }),
    S('s1_collect', 'seal', 'Pop Pop Pop', "Your fish are blowing Aero bubbles! Pop ten of them. Best. Sound. Ever.", [{ t: 'collect', n: 10 }], { aero: 3, items: { driftwood: 2 } }),
    S('s1_weather', 'seal', 'Funny Weather', "When the sky goes all bubbly or glossy, sneaky fish come out to play! Catch one in wild weather.", [{ t: 'catch', n: 1, weather: 'any' }], { aero: 4, bait: { worm: 1 } }),
    S('s1_twilight', 'fizz', 'Peek Below', "Under the sunlit water lies the Twilight Zone. Bring me two fish from down there. Mind the dark. It is very... dark.", [{ t: 'catch', n: 2, zone: 'twilight' }], { aero: 6, items: { fish_scale: 3 } }),
    S('s1_zap', 'fizz', 'Zap Happy', "Release the charge in the PERFECT window. Five perfect zaps and I'll write you a glowing reference. It literally glows.", [{ t: 'zap', n: 5 }], { aero: 4, items: { kelp_fibre: 2 } }),
    S('s1_release', 'seal', 'Swim Free', "Not every fish needs a tank. Let three swim home. They'll tell all their friends you're nice!", [{ t: 'release', n: 3 }], { aero: 3, items: { clover_leaf: 1 } }),
    S('s1_grouper', 'fizz', 'Grass Toucher', "The Touch Grass Grouper lives by the meadow. Rumour says it has touched actual grass. We must confirm!", [{ t: 'catch', n: 1, species: 'grouper' }], { aero: 4, items: { driftwood: 2 } }),
    S('s1_bait', 'seal', 'Fancy Snacks', "Crumbs are fine... but real bait is FANCY. Catch two fish with proper bait. Pinkies out!", [{ t: 'catch', n: 2, bait: 'any' }], { bait: { worm: 2 }, items: { shell: 1 } }),
    S('s1_dex', 'fizz', 'Meadow Census', "Science needs numbers! Discover six species that live in the (OS)cean. Clipboard ready!", [{ t: 'species', n: 6, biome: 'oscean' }], { aero: 7, items: { clover_leaf: 1 } }),
    S('s1_dress', 'seal', 'Dress to Impress', "Try something new in the Wardrobe! A hat? Goggles? I'm wearing my very best whiskers today.", [{ t: 'dress', n: 1 }], { aero: 2, items: { fish_scale: 2 } }),
    S('s1_trophy', 'fizz', 'Measure Twice', "Measure twice, catch once! Bring me a fish from the very top of its size chart. A trophy!", [{ t: 'catch', n: 1, trophy: true }], { aero: 6, items: { shell: 2, fish_scale: 1 } }),
    S('s1_night', 'seal', 'Starry Splash', "At night the (OS)cean twinkles like a screensaver. Catch a fish under the stars! (Night-time only, sleepyhead.)", [{ t: 'catch', n: 1, time: 'night' }], { aero: 4, bait: { worm: 1 } }),
    S('s1_evolve', 'seal', 'Glow Up', "Psst! Noobikarps have BIG dreams. Keep one in your tank for a while and see what it turns into!", [{ t: 'evolve', n: 1 }], { aero: 11, items: { pearl: 1 } }),
  ],
  ch2: [
    S('s2_honk', 'marina', 'No-Honk Zone', "Clown-to-Clown Fish keep honking at my dinghy. Catch two and tell them this is a no-honk zone.", [{ t: 'catch', n: 2, species: 'honk' }], { aero: 7, items: { sea_glass: 1 } }),
    S('s2_banana', 'seal', 'A-Peel-ing', "A Banana Fish! It's very a-peel-ing! Hehe. Sorry. Not sorry. Catch it!", [{ t: 'catch', n: 1, species: 'bananafish' }], { aero: 7, items: { shell: 2 } }),
    S('s2_seahorse', 'marina', 'Giddy-Up', "There's an Old Town Sea-Horse galloping through the seagrass. Yee-haw it into your bucket!", [{ t: 'catch', n: 1, species: 'seahorse' }], { aero: 11, items: { fin_ribbon: 1 } }),
    S('s2_rain', 'marina', 'Rain or Shine', "Rain or shine, a sailor fishes! Mostly shine. Today: wild weather. Catch three while it's grey!", [{ t: 'catch', n: 3, biome: 'shallows', weather: 'any' }], { aero: 11, items: { sea_glass: 2 } }),
    S('s2_shop', 'dot', 'Shop Till You Drop', "BEEP! Customer detected. Purchase three bait packs to unlock: my happy face. BOOP.", [{ t: 'bait', n: 3 }], { aero: 5, bait: { bread: 3 } }),
    S('s2_app', 'dot', 'Download Complete', "BEEP. App bait installed. Please catch three fish with it and rate five stars.", [{ t: 'catch', n: 3, bait: 'app' }], { aero: 9, bait: { worm: 2 } }, { after: 's2_shop' }),
    S('s2_party', 'seal', 'Tank Party', "Your tank is so quiet! Four fish swimming together makes it a party. I'll bring the bubbles.", [{ t: 'tankFish', n: 4 }], { aero: 9, items: { coral_chunk: 1 } }),
    S('s2_crafty', 'marina', 'Handy Paws', "My workbench needs a workout. Craft any two things. Sawdust is basically confetti!", [{ t: 'craft', n: 2 }], { aero: 9, items: { driftwood: 3 } }, { after: 'c2_workshop' }),
    S('s2_newrod', 'seal', 'New Rod Smell', "Ooh, try out a new rod! It smells like adventure. And a little bit like rubber duck.", [{ t: 'equip', n: 1 }], { aero: 5, items: { fish_scale: 3 } }, { after: 'c2_craftrod' }),
    S('s2_zap', 'fizz', 'Spark Joy', "Ten PERFECT zaps. Not nine. Nine is just a pile of almost.", [{ t: 'zap', n: 10 }], { aero: 9, items: { kelp_fibre: 3 } }),
    S('s2_smooth', 'marina', 'Smooth Sailing', "Land a fish without a single wobbly zap. Smooth as a freshly waxed deck!", [{ t: 'catch', n: 1, flawless: true }], { aero: 11, items: { fin_ribbon: 1 } }),
    S('s2_chest', 'seal', 'Treasure Snorkel', "Chests wash up everywhere around here. Crack open two! Maybe there's a snack inside. There's never a snack.", [{ t: 'chest', n: 2 }], { aero: 9, items: { pearl: 1 } }),
    S('s2_box', 'marina', 'Flotsam Friends', "Boxes bobbing by! Hook three before they drift off to somebody else's dock.", [{ t: 'box', n: 3 }], { aero: 9, items: { driftwood: 2, kelp_fibre: 1 } }),
    S('s2_halibut', 'marina', 'Smile Through It', "The Hide-the-Pain Halibut smiles through everything. Bring me a trophy-sized one. It'll smile even harder.", [{ t: 'catch', n: 1, species: 'flounder', trophy: true }], { aero: 13, items: { coral_chunk: 1 } }),
    S('s2_dex', 'fizz', 'Shallow Scholar', "The Shallows are bursting with new species! Discover six of them. My notebook is SO ready.", [{ t: 'species', n: 6, biome: 'shallows' }], { aero: 14, items: { sea_glass: 2 } }),
    S('s2_twilight', 'seal', 'Twilight Treats', "The colourful fish hide deeper down. Catch two Uncommon fish in the Twilight Zone. Wheee!", [{ t: 'catch', n: 2, rarity: 'uncommon', zone: 'twilight' }], { aero: 13, bait: { sugar: 1 } }),
  ],
  ch3: [
    S('s3_noot', 'bloat', 'Noot Noot', "Hrrumph! Tuxfish. Fancy fellows. In my day they wore bow ties to breakfast. Catch three.", [{ t: 'catch', n: 3, species: 'nootfish' }], { aero: 16, items: { ice_shard: 1 } }),
    S('s3_sticks', 'seal', 'Fish Fingers', "Frozen Fishsticks! They're... already frozen? Already sticks? Nature is weird. Two please!", [{ t: 'catch', n: 2, species: 'fishsticks' }], { aero: 14, items: { sea_glass: 1 } }),
    S('s3_vibe', 'seal', 'Vibe Check', "The Vibe Check Cod is checking everyone's vibes. Go pass the check! You've got great vibes.", [{ t: 'catch', n: 1, species: 'icebabycod' }], { aero: 14, items: { fin_ribbon: 1 } }),
    S('s3_aurora', 'fizz', 'Northern Lights', "When the aurora dances, the Fjord fish get dazzled. Catch one under the lights. For science! And the vibes.", [{ t: 'catch', n: 1, biome: 'fjord', weather: 'aurora' }], { aero: 25, items: { ice_shard: 2 } }),
    S('s3_snow', 'bloat', 'Snow Day', "Snow? Pfft. I fished through forty blizzards with a frozen moustache. Three fish in the snow, landlubber!", [{ t: 'catch', n: 3, biome: 'fjord', weather: ['snowfall', 'blizzard'] }], { aero: 20, items: { ice_shard: 1, sea_glass: 1 } }),
    S('s3_filter', 'fizz', 'Crystal Clear', "Murky water is bad science! Fit your tank with a Hang-on Filter. The fish will thank you. Quietly. They're fish.", [{ t: 'gearLv', id: 'filter', lv: 1 }], { aero: 20, items: { spring_coil: 1 } }),
    S('s3_decor', 'marina', 'Home Improvement', "A tank without decor is just a very wet box. Place three things in yours. Make it cosy!", [{ t: 'build', n: 3 }], { aero: 16, items: { driftwood: 3, shell: 2 } }),
    S('s3_tackle', 'marina', 'Accessorize', "Clip a piece of tackle onto your rod. Every rod deserves a little bling.", [{ t: 'tackle', n: 1 }], { aero: 16, items: { fin_ribbon: 2 } }),
    S('s3_midnight', 'bloat', 'Cold and Dark', "Down in the Fjord's Midnight Zone the fish have no manners. Catch two and teach them some.", [{ t: 'catch', n: 2, biome: 'fjord', zone: 'midnight' }], { aero: 25, bait: { lantern: 1 } }),
    S('s3_tale', 'bloat', 'Tall Tale', "Bring me a fjord fish so big I'll have to stop exaggerating. A trophy, I say!", [{ t: 'catch', n: 1, biome: 'fjord', trophy: true }], { aero: 20, items: { ice_shard: 1 } }),
    S('s3_flawless', 'fizz', 'Ice Cold', "Precision! Three flawless catches. Your zaps will be studied in textbooks. My textbooks. That I'm writing.", [{ t: 'catch', n: 3, flawless: true }], { aero: 20, items: { spring_coil: 1 } }),
    S('s3_mixer', 'fizz', 'Secret Recipe', "My Bait Mixer is the pinnacle of culinary science! Research it, mix a custom bait and catch two fish with it.", [{ t: 'research', id: 'bait_custom' }, { t: 'catch', n: 2, bait: 'custom' }], { aero: 25, items: { kelp_fibre: 3 } }),
    S('s3_mutant', 'fizz', 'Mutation Station', "A fish with a mutation! Extra spots? A funky glow? Bring me one. Don't tell the ethics board.", [{ t: 'catch', n: 1, mutant: true }], { aero: 25, items: { sea_glass: 2 } }),
    S('s3_dex', 'fizz', 'Glacier Guide', "Discover six species from the Frosty Fjord. Wear mittens while writing, ink freezes here.", [{ t: 'species', n: 6, biome: 'fjord' }], { aero: 25, items: { ice_shard: 2 } }),
    S('s3_online', 'marina', 'Friendly Seas', "Fishing's better with friends! Research Friendly Seas and go online once. Totally optional, matey.", [{ t: 'research', id: 'sea_multi' }, { t: 'online' }], { aero: 16, items: { shell: 3 } }, { online: true }),
  ],
  ch4: [
    S('s4_spam', 'fizz', 'Unsubscribe', "Clickbait Sardines! You WON'T BELIEVE what happens when you catch four. (Science happens.)", [{ t: 'catch', n: 4, species: 'spam' }], { aero: 25, items: { scrap_metal: 2 } }),
    S('s4_sus', 'seal', 'Very Suspicious', "That Sus Fish keeps sneaking around the scrap pile. Very suspicious! Catch it and get to the bottom of this.", [{ t: 'catch', n: 1, species: 'glitchminnow' }], { aero: 20, items: { gear: 1 } }),
    S('s4_rolled', 'seal', 'Got Rolled', "The Rickroll Rockfish keeps tricking everyone into following it. Turn the tables and reel it in!", [{ t: 'catch', n: 1, species: 'rockfish' }], { aero: 25, items: { spring_coil: 1 } }),
    S('s4_rain', 'fizz', 'Cloud Storage', "Data Rain! Every drop is a tiny byte. Catch three fish in it, or in a Static Storm, while it's downloading.", [{ t: 'catch', n: 3, biome: 'junkyard', weather: ['datarain', 'static'] }], { aero: 35, items: { circuit_board: 1 } }),
    S('s4_scrap', 'marina', 'Recycling Day', "The dock railing fell off. Again. Bring six Scrap Metal and I'll weld it back on with love.", [{ t: 'have', id: 'scrap_metal', n: 6, take: true }], { aero: 45, items: { gear: 2 } }),
    S('s4_stars', 'marina', 'Two Stars', "A good rod is a tuned rod. Upgrade any rod to two stars at the Workshop. Polish optional.", [{ t: 'rodUp', n: 2 }], { aero: 35, items: { spring_coil: 2 } }),
    S('s4_loot', 'fizz', 'Loot Goblin', "Iron Crates hold the good stuff. Crack open three of them, or better. I'll hold the crowbar. Theoretically.", [{ t: 'chest', n: 3, tier: 'iron' }], { aero: 40, items: { magnet_stone: 1 } }),
    S('s4_egg', 'seal', 'Egg-cellent', "Two happy fish plus a little romance equals EGGS! Research Fish Romance and hatch a baby. I'm not crying, you're crying.", [{ t: 'research', id: 'tank_romance' }, { t: 'hatch', n: 1 }], { aero: 45, items: { fish_egg: 1 } }),
    S('s4_heater', 'seal', 'Warm Fuzzies', "Brr! Your tank fish want a Glass Heater. Toasty water makes for happy fins.", [{ t: 'gearLv', id: 'heater', lv: 1 }], { aero: 30, items: { gear: 1 } }),
    S('s4_zap', 'fizz', 'Overclocked', "Twenty-five PERFECT zaps! I'll measure the voltage with my moustache. Don't ask.", [{ t: 'zap', n: 25 }], { aero: 35, items: { circuit_board: 1 } }),
    S('s4_rare', 'fizz', 'Rare Hardware', "The rarest glitches live in the Reef. Catch three Rare fish here. Bonus points if they're not printers.", [{ t: 'catch', n: 3, rarity: 'rare', biome: 'junkyard' }], { aero: 45, items: { magnet_stone: 1 } }),
    S('s4_full', 'seal', 'Packed House', "Eight fish in your tank! It's getting crowded in there. Like a bubbly little city!", [{ t: 'tankFish', n: 8 }], { aero: 25, items: { coral_chunk: 2 } }),
    S('s4_dumpster', 'marina', 'Salvage Crew', "Crates drift all over the Junkyard. Reel in five of them here. One person's junk is my new shelf.", [{ t: 'box', n: 5, biome: 'junkyard' }], { aero: 30, items: { scrap_metal: 3 } }),
    S('s4_couture', 'seal', 'Junk Couture', "The Junkyard is basically a runway. Strut your stuff! Change your look three times.", [{ t: 'dress', n: 3 }], { aero: 18, items: { fin_ribbon: 2 } }),
    S('s4_dex', 'fizz', 'Glitch Index', "Discover six Junkyard Reef species. Some may be duplicates. Some may be bugs. All are science.", [{ t: 'species', n: 6, biome: 'junkyard' }], { aero: 40, items: { circuit_board: 1 } }),
  ],
  ch5: [
    S('s5_taxi', 'marina', 'Taxi!', "Taxi-Crabs honk at everyone in rush hour. Hail three of them. With your hook.", [{ t: 'catch', n: 3, species: 'taxicrab' }], { aero: 45, items: { gear: 1 } }),
    S('s5_pigeon', 'seal', 'Is This a Quest?', "Is that a pigeon? Is it a fish? Is THIS a quest? Yes! Catch the Is-This-a-Pigeonfish!", [{ t: 'catch', n: 1, species: 'pigeonfish' }], { aero: 40, items: { pearl: 1 } }),
    S('s5_lofi', 'seal', 'Beats to Fish To', "Shh... the Lo-Fi Beats Tetras are studying. Catch two very, very quietly.", [{ t: 'catch', n: 2, species: 'neonpunk' }], { aero: 40, items: { glow_bulb: 1 } }),
    S('s5_rush', 'bloat', 'Rush Hour', "Rush hour! Fish everywhere, all late for work. Hrrumph. Catch four while they're distracted.", [{ t: 'catch', n: 4, biome: 'metropolis', weather: 'rushhour' }], { aero: 60, items: { circuit_board: 1 } }),
    S('s5_neon', 'fizz', 'Neon Nights', "A Neon Storm or a Blackout! Electrifying! Catch an Uncommon fish while the city flickers.", [{ t: 'catch', n: 1, rarity: 'uncommon', biome: 'metropolis', weather: ['neonstorm', 'blackout'] }], { aero: 50, items: { glow_bulb: 1 } }),
    S('s5_light', 'fizz', 'Mood Lighting', "Your tank needs an Aero LED! Light is the secret ingredient of plant science. And of selfies.", [{ t: 'gearLv', id: 'light', lv: 1 }], { aero: 50, items: { glow_bulb: 1 } }),
    S('s5_decor', 'marina', 'Interior Design', "Place six things in your tank. A castle here, a rubber duck there. Chef's kiss.", [{ t: 'build', n: 6 }], { aero: 50, items: { coral_chunk: 3 } }),
    S('s5_part', 'marina', 'Custom Hull', "A boat is only as good as its bits! Craft a boat part at the Workshop and bolt it on.", [{ t: 'craft', n: 1, cat: 'boat' }], { aero: 60, items: { gear: 2 } }),
    S('s5_sonar', 'marina', 'Ping!', "The Fish Finder pings fish like a doorbell. Research it and never fish blind again.", [{ t: 'research', id: 'boat_sonar' }], { aero: 50, items: { circuit_board: 1 } }),
    S('s5_flawless', 'bloat', 'Main Character Energy', "Five flawless catches in the Metropolis. Walk like you own the street. Hrrumph, I did, once.", [{ t: 'catch', n: 5, biome: 'metropolis', flawless: true }], { aero: 65, items: { pearl: 1 } }),
    S('s5_giant', 'bloat', 'Absolute Unit', "They call me a teller of tall tales! Bring me a GIANT fish and we'll see who's exaggerating.", [{ t: 'catch', n: 1, giant: true }], { aero: 85, items: { pearl: 2 } }),
    S('s5_golden', 'dot', 'Golden Investment', "BEEP. Golden Bait detected. Use it to catch a Rare fish. Return on investment: guaranteed. Probably.", [{ t: 'catch', n: 1, rarity: 'rare', bait: 'golden' }], { aero: 65, bait: { golden: 1 } }, { after: 'c5_epic' }),
    S('s5_babies', 'seal', 'Baby Boom', "More eggs, more babies, more tiny fins! Hatch three eggs. I've already knitted three tiny hats.", [{ t: 'hatch', n: 3 }], { aero: 65, items: { fish_egg: 1 } }, { after: 's4_egg' }),
    S('s5_dex', 'fizz', 'City Directory', "Discover six species of the Sunken Metropolis. Most of them have business cards.", [{ t: 'species', n: 6, biome: 'metropolis' }], { aero: 65, items: { circuit_board: 1 } }),
    S('s5_party', 'seal', 'Party Boat', "Fishing with friends gives everyone luck! Catch three fish while another player shares your ocean. Optional and extra fun!", [{ t: 'catch', n: 3, party: true }], { aero: 40, items: { pearl: 1 } }, { online: true }),
  ],
  ch6: [
    S('s6_fine', 'seal', 'Everything Is Fine', "Everything's on fire and the This-Is-Fine Fish is totally chill. Catch three. It's fine. Everything's fine!", [{ t: 'catch', n: 3, species: 'fireflower' }], { aero: 60, items: { lava_glass: 1 } }),
    S('s6_floor', 'bloat', 'The Floor Is Lava', "In my day the floor was ALWAYS lava. Uphill. Both ways. Catch two Floor-Is-Lava Gobies.", [{ t: 'catch', n: 2, species: 'floorlava' }], { aero: 60, items: { ancient_stone: 1 } }),
    S('s6_chef', 'marina', 'Let Him Cook', "The Let-Him-Cook Chef-fish makes the best vent-roasted kelp. Catch it and ask for the recipe!", [{ t: 'catch', n: 1, species: 'chefsnapper' }], { aero: 70, items: { lava_glass: 1 } }),
    S('s6_pizza', 'seal', 'Hot Debate', "The Pineapple Pizza Fish says pineapple belongs on pizza. Catch it so we can... discuss.", [{ t: 'catch', n: 1, species: 'pizzafish' }], { aero: 60, items: { ancient_stone: 1 } }),
    S('s6_eruption', 'fizz', 'Hot Hot Hot', "An Eruption or a Magma Bloom! The fish go wild. Catch three while it's sizzling. Oven mitts on!", [{ t: 'catch', n: 3, biome: 'volcano', weather: ['eruption', 'magma'] }], { aero: 80, items: { lava_glass: 2 } }),
    S('s6_air', 'seal', 'Bubble Wall', "A Bubble Wall for the tank! The fish can play in the stream like a waterpark. Weee!", [{ t: 'gearLv', id: 'air', lv: 2 }], { aero: 80, items: { circuit_board: 1 } }),
    S('s6_zap', 'fizz', 'Spark Plug', "Sixty PERFECT zaps. My hair is standing up just thinking about it. More than usual.", [{ t: 'zap', n: 60 }], { aero: 80, items: { circuit_board: 2 } }),
    S('s6_sizzle', 'bloat', 'Big Sizzle', "Two trophy fish from the Rift! Big enough to roast a marshmallow on. Hrrumph. Not that I would.", [{ t: 'catch', n: 2, biome: 'volcano', trophy: true }], { aero: 80, items: { lava_glass: 1 } }),
    S('s6_epic', 'bloat', 'Epic Heat', "An Epic fish from the Lava Rift! Now THAT is a tale worth the singed eyebrows.", [{ t: 'catch', n: 1, rarity: 'epic', biome: 'volcano' }], { aero: 110, items: { ancient_stone: 2 } }),
    S('s6_bottom', 'seal', 'Rock Bottom', "The bottom of the Rift glows red and grumbles. Catch three fish in the Abyssal Zone here. Hold my flipper!", [{ t: 'catch', n: 3, biome: 'volcano', zone: 'abyss' }], { aero: 100, bait: { lantern: 1 } }),
    S('s6_glass', 'marina', 'Glassblower', "I'm making a lava-glass window for the Workshop. Bring me three Lava Glass. Oven mitts recommended!", [{ t: 'have', id: 'lava_glass', n: 3, take: true }], { aero: 120, items: { ancient_stone: 2 } }),
    S('s6_bosses', 'bloat', 'Trophy Wall', "Hrrumph! A proper angler has a wall of boss trophies. Beat four different bosses.", [{ t: 'total', k: 'bosses', n: 4 }], { aero: 100, items: { abyss_crystal: 1 } }),
    S('s6_rods', 'marina', 'Rod Rack', "My rod rack has eight hooks and they're all empty! Own eight rods. Any rods.", [{ t: 'total', k: 'rods', n: 8 }], { aero: 80, items: { lava_glass: 1 } }),
    S('s6_dex', 'fizz', 'Hot Index', "Discover six Lava Rift species. Write fast before the notebook catches fire.", [{ t: 'species', n: 6, biome: 'volcano' }], { aero: 90, items: { ancient_stone: 1 } }),
    S('s6_spicy', 'seal', 'Spicy!', "The Spicy Meme Pepperfish makes my whiskers tingle. Catch one with any proper bait. Ah... ah... ACHOO!", [{ t: 'catch', n: 1, species: 'jalapeno', bait: 'any' }], { aero: 70, items: { lava_glass: 1 } }),
  ],
  ch7: [
    S('s7_battery', 'seal', 'Low Battery', "The Lanternfish are at 1% battery! Catch three and plug them into the tank. Charging...", [{ t: 'catch', n: 3, species: 'lanternfish' }], { aero: 115, items: { glow_bulb: 1 } }),
    S('s7_monday', 'bloat', 'Case of the Mondays', "The It's-Monday Blobfish looks how I feel before breakfast. Catch it. We'll commiserate.", [{ t: 'catch', n: 1, species: 'blobfish' }], { aero: 115, items: { ancient_stone: 1 } }),
    S('s7_dumbo', 'seal', 'Smol Bean', "The Smol Bean Dumbo is the cutest thing in the Deep. Catch it gently! GENTLY!", [{ t: 'catch', n: 1, species: 'dumbo' }], { aero: 180, items: { pearl: 2 } }),
    S('s7_squid', 'fizz', 'Bedtime, Gamer', "The Squid Gamer has been awake for forty hours. Catch it and make it go to bed. Science requires sleep.", [{ t: 'catch', n: 1, species: 'vampsquid' }], { aero: 180, items: { abyss_crystal: 1 } }),
    S('s7_tide', 'fizz', 'Glow With the Flow', "Glow Tide or a Deep Current! The Deep lights up like a disco. Catch three fish while it shimmers.", [{ t: 'catch', n: 3, biome: 'abyss', weather: ['glowtide', 'current'] }], { aero: 155, items: { glow_bulb: 2 } }),
    S('s7_abyss', 'bloat', 'Abyss Gazer', "Stare into the abyss and the abyss bites your hook. Catch five fish in the Deep's Abyssal Zone.", [{ t: 'catch', n: 5, biome: 'abyss', zone: 'abyss' }], { aero: 210, items: { abyss_crystal: 1 } }),
    S('s7_shiny', 'seal', 'Shiny!', "A SHINY fish! It sparkles like my eyes when I see a sardine. Catch one, anywhere!", [{ t: 'catch', n: 1, shiny: true }], { aero: 235, items: { pearl: 2 } }),
    S('s7_master', 'fizz', 'Masterclass', "Ten flawless catches. Your zapping is now officially a peer-reviewed art form.", [{ t: 'catch', n: 10, flawless: true }], { aero: 180, items: { circuit_board: 2 } }),
    S('s7_reef', 'marina', 'Reef Dreams', "Your fish deserve a whole reef! Get the Reef Tank. I'll help carry the gravel.", [{ t: 'tank', tier: 4 }], { aero: 210, items: { coral_chunk: 4 } }),
    S('s7_filter', 'fizz', 'Turbo Filtration', "The Turbo Aero Filter! Water so clean you can see tomorrow. Upgrade the Filter all the way.", [{ t: 'gearLv', id: 'filter', lv: 3 }], { aero: 210, items: { glow_bulb: 1 } }),
    S('s7_hole', 'dot', 'Event Horizon', "BEEP. Black Hole Bait detected. Catch a Rare fish with it. Warning: do not look directly at the bait. BOOP.", [{ t: 'catch', n: 1, rarity: 'rare', bait: 'blackhole' }], { aero: 155, bait: { blackhole: 1 } }, { after: 'c6_deep' }),
    S('s7_crafter', 'marina', 'Master Crafter', "Ten crafts! Your hands are pure magic. And covered in glue. Mostly magic.", [{ t: 'craft', n: 10 }], { aero: 155, items: { ancient_stone: 2 } }),
    S('s7_legends', 'bloat', 'Legends Never Die', "One legend is luck. Three is a reputation! Catch three Legendary fish. Hrrumph, impress me.", [{ t: 'catch', n: 3, rarity: 'legendary' }], { aero: 390, items: { abyss_crystal: 2 } }),
    S('s7_seven', 'seal', 'Seven Seas', "You've seen so much! Visit all seven oceans. I'll make a scrapbook with sea-glass stickers.", [{ t: 'total', k: 'oceans', n: 7 }], { aero: 155, items: { pearl: 2 } }),
    S('s7_dex', 'fizz', 'Deep Directory', "Discover eight species of The Deep Ocean. Many have glowing bits. All have opinions.", [{ t: 'species', n: 8, biome: 'abyss' }], { aero: 210, items: { abyss_crystal: 1 } }),
  ],
};

// ------------------------------------------------------------------ milestones
export const MILESTONE_LINES = [
  { id: 'catch', name: 'Fish Caught', icon: 'hook' },
  { id: 'dex', name: 'FishDex', icon: 'book' },
  { id: 'aero', name: 'Aero Earned', icon: 'coin' },
  { id: 'lab', name: 'Research', icon: 'beaker' },
  { id: 'boss', name: 'Bosses', icon: 'trophy' },
  { id: 'zap', name: 'Perfect Zaps', icon: 'bolt' },
  { id: 'flawless', name: 'Flawless Catches', icon: 'star' },
  { id: 'deep', name: 'Deep Diver', icon: 'sonar' },
  { id: 'oceans', name: 'Oceans Visited', icon: 'compass' },
  { id: 'chest', name: 'Chests Opened', icon: 'mat:pkg_golden' },
  { id: 'box', name: 'Boxes Salvaged', icon: 'box' },
  { id: 'feed', name: 'Feeding Time', icon: 'food' },
  { id: 'build', name: 'Tank Builder', icon: 'decor' },
  { id: 'craft', name: 'Crafting', icon: 'hammer' },
  { id: 'hatch', name: 'Hatchery', icon: 'egg' },
  { id: 'release', name: 'Released', icon: 'heart' },
  { id: 'giant', name: 'Giants', icon: 'crown' },
  { id: 'mutant', name: 'Mutations', icon: 'dna' },
  { id: 'shiny', name: 'Shinies', icon: 'sparkle' },
  { id: 'style', name: 'Wardrobe', icon: 'people' },
  { id: 'rods', name: 'Rod Collection', icon: 'rod:duck' },
  { id: 'orders', name: 'Orders Filled', icon: 'shop' },
  { id: 'quests', name: 'Quests Done', icon: 'trophy' },
];

const M = (line, tier, k, n, giver, title, text, reward) => ({ id: `m_${line}_${tier}`, line, tier, giver, title, text, objectives: [{ t: 'total', k, n }], reward });
export const MILESTONES = [
  M('catch', 1, 'caught', 10, 'seal', 'Ten Little Fishies', "Ten fish! I counted them twice. Then I counted my flippers. Also ten-ish!", { aero: 15, items: { fish_scale: 3 } }),
  M('catch', 2, 'caught', 50, 'seal', 'Fifty Fins', "Fifty fish! You're officially a regular. They should name a bench after you.", { aero: 60, items: { kelp_fibre: 4 } }),
  M('catch', 3, 'caught', 200, 'bloat', 'Two Hundred Splashes', "Two hundred! Hrrumph. That's nearly as many as I caught before breakfast. Nearly.", { aero: 300, items: { pearl: 1 } }),
  M('catch', 4, 'caught', 500, 'marina', 'Five Hundred Club', "Five hundred catches! I'm painting your name on the pier. In glitter.", { aero: 1200, items: { pkg_golden: 1 } }),
  M('catch', 5, 'caught', 1000, 'fizz', 'One Thousand Hooks', "One thousand fish! Statistically, the ocean now has a you-shaped hole in it.", { aero: 4000, cosmetics: ['hat_crown'] }),

  M('dex', 1, 'species', 10, 'fizz', 'Page Turner', "Ten species in the FishDex! The pages are rustling with excitement. Or that's the fan.", { aero: 25, items: { shell: 3 } }),
  M('dex', 2, 'species', 25, 'seal', 'Bookworm', "Twenty-five species! The FishDex is getting chonky. Like me!", { aero: 150, items: { sea_glass: 3 } }),
  M('dex', 3, 'species', 50, 'fizz', 'Field Guide', "Fifty species! I'm submitting your notes to the Journal of Extremely Silly Fish.", { aero: 800, items: { rare_specimen: 1 } }),
  M('dex', 4, 'species', 75, 'bloat', 'Living Library', "Seventy-five! Hrrumph. In my day the FishDex was a napkin with three doodles on it.", { aero: 2500, items: { abyss_crystal: 1 } }),
  M('dex', 5, 'species', 100, 'fizz', 'Completionist', "One hundred species! The FishDex is purring. I didn't know books could purr.", { aero: 6000, cosmetics: ['face_star'] }),

  M('aero', 1, 'aero', 500, 'dot', 'Pocket Change', "BEEP. Lifetime Aero: 500. Wallet status: jingly. BOOP.", { aero: 20, bait: { worm: 2 } }),
  M('aero', 2, 'aero', 5000, 'dot', 'Savings Account', "BEEP BEEP. 5,000 Aero earned. Recommended action: one celebratory spin. Spinning... done.", { aero: 120, bait: { golden: 1 } }),
  M('aero', 3, 'aero', 25000, 'dot', 'Big Bubble Bucks', "BOOP! 25,000 Aero. My calculator needs a bigger screen.", { aero: 500, items: { pkg_iron: 1 } }),
  M('aero', 4, 'aero', 100000, 'dot', 'Aero Mogul', "ALERT: 100,000 Aero. Please do not buy the ocean. It is not for sale. Yet.", { aero: 2000, items: { pkg_golden: 1 } }),
  M('aero', 5, 'aero', 500000, 'dot', 'Bubble Baron', "500,000 Aero. Processing... processing... I need to sit down. I do not have legs.", { aero: 8000, cosmetics: ['gloves_gold'] }),

  M('lab', 1, 'research', 5, 'fizz', 'Beaker Buddy', "Five experiments and zero explosions! A personal record for this Lab.", { aero: 20, items: { kelp_fibre: 3 } }),
  M('lab', 2, 'research', 15, 'fizz', 'Test Tube Tycoon', "Fifteen projects! My bubbling flasks are bubbling with pride.", { aero: 120, items: { gear: 1 } }),
  M('lab', 3, 'research', 30, 'fizz', 'Mad Scientist', "Thirty! You've got that wild look in your eye. I recognise it from my mirror.", { aero: 600, items: { circuit_board: 2 } }),
  M('lab', 4, 'research', 60, 'fizz', 'Professor Emeritus', "Sixty research projects! I'm ordering you a lab coat with extra pockets for snacks.", { aero: 3000, items: { rare_specimen: 2 } }),
  M('lab', 5, 'research', 100, 'fizz', 'Big Brain Energy', "One hundred projects! The Lab now runs on your brainwaves. Please think calm thoughts.", { aero: 9000, items: { pkg_orb: 1 } }),

  M('boss', 1, 'bosses', 1, 'bloat', 'Boss Fight!', "Your first boss! Hrrumph. I'd shake your hand if I had one. Or arms. Take this instead.", { aero: 40, items: { fish_scale: 4 } }),
  M('boss', 2, 'bosses', 3, 'bloat', 'Big Game Angler', "Three bosses beaten! The deep is starting to whisper your name. Nervously.", { aero: 400, items: { pkg_iron: 1 } }),
  M('boss', 3, 'bosses', 5, 'bloat', 'Boss Buster', "Five bosses! They're forming a support group. You're the main topic.", { aero: 2000, items: { pkg_golden: 1 } }),
  M('boss', 4, 'bosses', 7, 'bloat', 'Legend of the Seven Seas', "All seven bosses! Hrrumph... I'm not crying, the sea spray got in my eye.", { aero: 8000, cosmetics: ['shoes_moon'] }),

  M('zap', 1, 'zaps', 10, 'fizz', 'Spark Starter', "Ten PERFECT zaps! The capacitor is giggling. I didn't know they could do that.", { aero: 20, items: { kelp_fibre: 2 } }),
  M('zap', 2, 'zaps', 50, 'fizz', 'Live Wire', "Fifty perfect zaps! You're more electric than my hairdo.", { aero: 150, items: { spring_coil: 2 } }),
  M('zap', 3, 'zaps', 200, 'fizz', 'Thunder Thumbs', "Two hundred! Your thumbs should be registered as a power plant.", { aero: 800, items: { circuit_board: 2 } }),
  M('zap', 4, 'zaps', 500, 'fizz', 'Lightning in a Bottle', "Five hundred perfect zaps! I've bottled some. It's on my desk. It hums.", { aero: 3000, items: { pkg_golden: 1 } }),

  M('flawless', 1, 'flawless', 5, 'marina', 'Clean Hands', "Five flawless catches! Not a single wobble. Neat as a freshly coiled rope.", { aero: 30, items: { fin_ribbon: 2 } }),
  M('flawless', 2, 'flawless', 25, 'marina', 'Smooth Operator', "Twenty-five flawless fights! The fish are writing you thank-you notes.", { aero: 300, items: { pearl: 1 } }),
  M('flawless', 3, 'flawless', 100, 'marina', 'Picture Perfect', "One hundred flawless catches! I've framed one. It's on the Workshop wall.", { aero: 2500, items: { pkg_golden: 1 } }),

  M('deep', 1, 'zones', 2, 'bloat', 'Twilight Toes', "Dipped your toes in the Twilight Zone! It's like the sunlit bit but moodier.", { aero: 15, bait: { worm: 2 } }),
  M('deep', 2, 'zones', 3, 'bloat', 'Midnight Express', "The Midnight Zone! Hrrumph. Even I bring a nightlight down there.", { aero: 100, bait: { lantern: 1 } }),
  M('deep', 3, 'zones', 4, 'bloat', 'Rock Bottom', "The Abyss itself! Nothing below you but floor and a few very surprised fish.", { aero: 400, cosmetics: ['trail_sparkle'] }),

  M('oceans', 1, 'oceans', 3, 'marina', 'Island Hopper', "Three oceans! Your boat has more stamps than my passport.", { aero: 60, items: { sea_glass: 2 } }),
  M('oceans', 2, 'oceans', 5, 'marina', 'Seasoned Sailor', "Five oceans! You've got salt in your hair and adventure in your heart.", { aero: 700, items: { pearl: 1 } }),
  M('oceans', 3, 'oceans', 7, 'marina', 'Globetrotter', "All seven oceans! I'm adding a gold star to your corner of the map.", { aero: 3500, items: { pkg_golden: 1 } }),

  M('chest', 1, 'chests', 5, 'seal', 'Crack Shot', "Five chests cracked! Pop goes the lid! Any snacks? No? Still fun!", { aero: 25, items: { pkg_crate: 1 } }),
  M('chest', 2, 'chests', 20, 'seal', 'Treasure Hunter', "Twenty chests! Your Satchel jingles when you walk. Do bubble people walk? You bounce.", { aero: 300, items: { pkg_iron: 1 } }),
  M('chest', 3, 'chests', 50, 'seal', 'Lid Legend', "Fifty chests! The locks see you coming and just give up.", { aero: 2000, items: { pkg_orb: 1 } }),

  M('box', 1, 'boxes', 5, 'marina', 'Beachcomber', "Five boxes fished out of the waves! Every one a little surprise.", { aero: 20, items: { driftwood: 4 } }),
  M('box', 2, 'boxes', 25, 'marina', 'Salvage Expert', "Twenty-five boxes! The gulls have filed a complaint. Ignored!", { aero: 250, items: { pkg_crate: 1 } }),
  M('box', 3, 'boxes', 100, 'marina', 'Lord of the Flotsam', "One hundred boxes! Nothing floats past you. Not even my lunch.", { aero: 1800, items: { pkg_golden: 1 } }),

  M('feed', 1, 'fed', 10, 'seal', 'Snack Captain', "Ten feedings! The fish do a little happy wiggle when you walk by.", { aero: 15, items: { shell: 3 } }),
  M('feed', 2, 'fed', 50, 'seal', 'Fish Chef', "Fifty meals served! Five stars from every fin in the tank.", { aero: 150, items: { coral_chunk: 2 } }),
  M('feed', 3, 'fed', 200, 'seal', 'All-You-Can-Eat', "Two hundred feedings! Your fish are round and VERY happy. Like me!", { aero: 1200, cosmetics: ['emote_dance'] }),

  M('build', 1, 'built', 5, 'marina', 'Decorator', "Five pieces in the tank! It's starting to look like a real home.", { aero: 25, items: { coral_chunk: 1 } }),
  M('build', 2, 'built', 20, 'marina', 'Architect', "Twenty! Your tank has a skyline now. And a rubber duck district.", { aero: 300, items: { pkg_iron: 1 } }),
  M('build', 3, 'built', 50, 'marina', 'Master Builder', "Fifty placements! I'd hire you, but you'd outbuild me by Tuesday.", { aero: 1800, items: { pkg_golden: 1 } }),

  M('craft', 1, 'crafted', 5, 'marina', 'Tinkerer', "Five crafts! You've got sawdust on your nose. It suits you.", { aero: 30, items: { driftwood: 3 } }),
  M('craft', 2, 'crafted', 25, 'marina', 'Artisan', "Twenty-five crafts! The Workshop smells like varnish and victory.", { aero: 400, items: { gear: 2 } }),
  M('craft', 3, 'crafted', 75, 'marina', 'Workshop Wizard', "Seventy-five! My tools have started following you around. Traitors.", { aero: 2500, items: { pkg_golden: 1 } }),

  M('hatch', 1, 'hatched', 1, 'seal', 'First Hatchling', "A baby fish! It's so tiny! It has a tiny face! I need to lie down.", { aero: 60, items: { fish_egg: 1 } }),
  M('hatch', 2, 'hatched', 5, 'seal', 'Fish Nanny', "Five little hatchlings! I'm making them matching name tags.", { aero: 400, items: { pearl: 1 } }),
  M('hatch', 3, 'hatched', 20, 'seal', 'Hatchery Hero', "Twenty babies! The tank is a nursery now. A very bubbly one.", { aero: 2000, cosmetics: ['trail_hearts'] }),

  M('release', 1, 'released', 10, 'seal', 'Catch & Release', "Ten fish set free! They're all telling the ocean how nice you are.", { aero: 15, items: { clover_leaf: 1 } }),
  M('release', 2, 'released', 50, 'seal', 'Friend of the Sea', "Fifty releases! The fish wave at your boat now. With their fins!", { aero: 150, items: { clover_leaf: 2 } }),
  M('release', 3, 'released', 200, 'seal', 'Ocean Guardian', "Two hundred fish released! You're basically a superhero. A wet one.", { aero: 1200, items: { pearl: 2 } }),

  M('giant', 1, 'giant', 1, 'bloat', 'Whopper', "A GIANT! Hrrumph! For once a story that needs no exaggerating.", { aero: 80, items: { pearl: 1 } }),
  M('giant', 2, 'giant', 5, 'bloat', 'Big Fish Energy', "Five giants! Your boat is sitting a bit lower in the water these days.", { aero: 600, items: { pkg_iron: 1 } }),
  M('giant', 3, 'giant', 20, 'bloat', 'Titan Tamer', "Twenty giants! I've retired my tallest tale. Yours are taller and true.", { aero: 3000, items: { pkg_golden: 1 } }),

  M('mutant', 1, 'mutant', 1, 'fizz', 'Weird Science', "A mutated fish! Fascinating! It has... extra fabulousness.", { aero: 40, items: { fish_sample: 1 } }),
  M('mutant', 2, 'mutant', 10, 'fizz', 'Gene Genie', "Ten mutations! My research paper is now 400 pages. All footnotes.", { aero: 500, items: { rare_specimen: 1 } }),
  M('mutant', 3, 'mutant', 30, 'fizz', 'Mutation Maestro', "Thirty mutated fish! The ethics board sent a fruit basket. Suspicious.", { aero: 2500, items: { pkg_golden: 1 } }),

  M('shiny', 1, 'shiny', 1, 'seal', 'Shiny Hunter', "A SHINY! It's sparkling! I'm sparkling! Everything is sparkling!", { aero: 300, items: { pearl: 2 } }),
  M('shiny', 2, 'shiny', 5, 'seal', 'Glitter Galore', "Five shinies! You must have a four-leaf kelp in your pocket. Can I see it?", { aero: 3000, cosmetics: ['eyes_star'] }),

  M('style', 1, 'cosmetics', 25, 'seal', 'Fresh Fit', "Twenty-five pieces in your Wardrobe! You'd win every fashion show. Even mine.", { aero: 40, items: { fin_ribbon: 2 } }),
  M('style', 2, 'cosmetics', 45, 'seal', 'Trendsetter', "Forty-five looks! The other bubble people are copying your style.", { aero: 400, items: { fin_ribbon: 3 } }),
  M('style', 3, 'cosmetics', 80, 'seal', 'Fashion Icon', "Eighty items! Your wardrobe needs its own wardrobe.", { aero: 2000, items: { pkg_golden: 1 } }),

  M('rods', 1, 'rods', 3, 'marina', 'Rod Starter', "Three rods! One for good days, one for bad days, one for showing off.", { aero: 40, items: { fish_scale: 4 } }),
  M('rods', 2, 'rods', 8, 'marina', 'Rod Curator', "Eight rods! You need a bigger umbrella stand.", { aero: 500, items: { spring_coil: 2 } }),
  M('rods', 3, 'rods', 15, 'marina', 'Rod Museum', "Fifteen rods! I'm charging admission to see your collection.", { aero: 3000, items: { pkg_golden: 1 } }),

  M('orders', 1, 'orders', 3, 'dot', 'Order Up!', "BEEP. Three orders filled. Customer satisfaction: maximum. Smile.exe running.", { aero: 25, bait: { worm: 2 } }),
  M('orders', 2, 'orders', 15, 'dot', 'Reliable Supplier', "BOOP. Fifteen orders delivered. You have been promoted to Favourite Human.", { aero: 300, items: { pkg_iron: 1 } }),
  M('orders', 3, 'orders', 50, 'dot', 'Order Legend', "BEEP BEEP BEEP. Fifty orders. My order book is now just your name, fifty times.", { aero: 2000, items: { pkg_golden: 1 } }),

  M('quests', 1, 'quests', 10, 'seal', 'Helping Flipper', "Ten quests done! Everyone at the pier is talking about you. Nicely!", { aero: 25, items: { shell: 3 } }),
  M('quests', 2, 'quests', 50, 'seal', 'Local Hero', "Fifty quests! You're the hero of the (OS)cean. Can I have your autograph?", { aero: 600, items: { pkg_iron: 1 } }),
  M('quests', 3, 'quests', 100, 'marina', 'Seasoned Adventurer', "A hundred quests! Your logbook is thicker than my anchor rope.", { aero: 3000, items: { pkg_golden: 1 } }),
  M('quests', 4, 'quests', 150, 'fizz', 'Quest Champion', "One hundred and fifty quests! I've run out of gold stars. Here, have the whole sticker sheet.", { aero: 8000, cosmetics: ['back_jetpack'] }),
];

// ------------------------------------------------------------------ "Today's orders"
// One order pays about DAILY_AERO[ch] x k (+ a material); filling all three adds a chest.
export const DAILY_AERO = [8, 18, 45, 100, 230, 480, 1000];
export const ORDER_MATS = [
  ['driftwood', 'kelp_fibre', 'shell', 'fish_scale'],
  ['sea_glass', 'coral_chunk', 'fin_ribbon', 'shell'],
  ['ice_shard', 'sea_glass', 'fin_ribbon', 'spring_coil'],
  ['scrap_metal', 'gear', 'spring_coil', 'circuit_board'],
  ['circuit_board', 'glow_bulb', 'gear', 'pearl'],
  ['lava_glass', 'ancient_stone', 'circuit_board', 'glow_bulb'],
  ['abyss_crystal', 'ancient_stone', 'glow_bulb', 'pearl'],
];
// common, no-weather, no-time species per ocean (for the "Survey Says" order)
const SURVEY = {
  oscean: ['loafer', 'googly', 'clickcrab', 'zebrafish', 'grouper'],
  shallows: ['honk', 'bananafish', 'catfish', 'starfish', 'puffer'],
  fjord: ['icebabycod', 'fishsticks', 'nootfish', 'chillsculpin', 'snowcrab'],
  junkyard: ['spam', 'bitfish', 'glitchminnow', 'dogfish', 'seabass'],
  metropolis: ['neonpunk', 'conefish', 'pigeonfish', 'taxicrab'],
  volcano: ['fireflower', 'floorlava', 'ashsnapper', 'pizzafish', 'steamcrab'],
  abyss: ['lanternfish', 'hatchet', 'isopod', 'blobfish', 'toadfish'],
};
const pickOcean = (c, r) => r.pick(c.oceans.length ? c.oceans : ['oscean']);

export const ORDER_POOL = [
  { id: 'snack', giver: 'seal', title: 'Snack Run', k: 1, minCh: 0, text: "I promised the tank a party. Catch some guests! No sharks. Okay, small sharks.",
    make: (c) => [{ t: 'catch', n: 4 + c.ch }] },
  { id: 'local', giver: 'marina', title: 'Local Catch', k: 1.1, minCh: 1, text: "The fish market wants something local today. Fresh from this ocean, on the ticket!",
    make: (c, r) => [{ t: 'catch', n: 3 + Math.ceil(c.ch / 2), biome: pickOcean(c, r) }] },
  { id: 'specimen', giver: 'fizz', title: 'Specimen Request', k: 1.2, minCh: 0, text: "My microscope is bored. Bring it something with a bit of rarity!",
    make: (c) => [{ t: 'catch', n: c.ch >= 3 ? 2 : 1, rarity: c.ch >= 4 ? 'rare' : 'uncommon' }] },
  { id: 'spark', giver: 'fizz', title: 'Spark Drill', k: 0.9, minCh: 0, text: "Calibration day! Fire PERFECT zaps so I can tune the zap-o-meter.",
    make: (c) => [{ t: 'zap', n: 3 + c.ch }] },
  { id: 'clean', giver: 'marina', title: 'Clean Landing', k: 1.2, minCh: 1, text: "A customer wants a fish without a single scorch mark. Flawless, please!",
    make: (c) => [{ t: 'catch', n: c.ch >= 4 ? 2 : 1, flawless: true }] },
  { id: 'deep', giver: 'bloat', title: 'Deep Order', k: 1.2, minCh: 1, text: "Hrrumph. One deep fish, extra spooky. Don't let any sunlight in the bucket!",
    make: (c) => [{ t: 'catch', n: 2, zone: c.ch >= 4 ? 'midnight' : 'twilight' }] },
  { id: 'weather', giver: 'marina', title: 'Weather Watch', k: 1.1, minCh: 1, text: "The forecast says wild weather. The fish say 'yes please'. Catch some while it lasts!",
    make: () => [{ t: 'catch', n: 2, weather: 'any' }] },
  { id: 'brag', giver: 'bloat', title: 'Bragging Rights', k: 1.2, minCh: 1, text: "I bet the pier crew a trophy fish. Don't make me lose my hat again. Hrrumph.",
    make: () => [{ t: 'catch', n: 1, trophy: true }] },
  { id: 'tummy', giver: 'seal', title: 'Tummy Time', k: 0.7, minCh: 0, text: "The tank is doing the hungry wiggle! Feed them! Feed them now!",
    make: () => [{ t: 'feed', n: 3 }] },
  { id: 'pop', giver: 'seal', title: 'Pop Patrol', k: 0.7, minCh: 0, text: "Aero bubbles are piling up in the tank. Pop them before they float off!",
    make: (c) => [{ t: 'collect', n: 8 + c.ch * 2 }] },
  { id: 'free', giver: 'seal', title: 'Freedom Friday', k: 0.8, minCh: 0, text: "Let some fish swim home today. Free hugs for everyone! (It doesn't have to be Friday.)",
    make: () => [{ t: 'release', n: 3 }] },
  { id: 'sale', giver: 'dot', title: 'Flash Sale', k: 0.8, minCh: 0, text: "BEEP! FLASH SALE. Limited time. Very limited. Okay, it's always on. Buy bait!",
    make: () => [{ t: 'bait', n: 2 }] },
  { id: 'fieldtest', giver: 'dot', title: 'Field Test', k: 1, minCh: 0, text: "BOOP. Quality control requires real-world testing. Catch fish with proper bait!",
    make: () => [{ t: 'catch', n: 2, bait: 'any' }] },
  { id: 'salvage', giver: 'marina', title: 'Salvage Run', k: 1, minCh: 0, text: "Crates are bobbing about again. Salvage them before the gulls do!",
    make: () => [{ t: 'box', n: 2 }] },
  { id: 'shift', giver: 'marina', title: 'Workshop Shift', k: 1, minCh: 1, needs: 'workshop', text: "Busy day at the Workshop! Craft something, anything. Sawdust optional.",
    make: (c) => [{ t: 'craft', n: c.ch >= 3 ? 2 : 1 }] },
  { id: 'supply', giver: 'marina', title: 'Supply Drop', k: 1.4, minCh: 1, text: "The dock needs supplies! Bring these over and I'll pay more than they're worth. Shh.",
    make: (c) => [{ t: 'have', id: c.mat, n: 2 + Math.floor(c.ch / 2), take: true }] },
  { id: 'survey', giver: 'fizz', title: 'Survey Says', k: 1, minCh: 0, text: "Survey time! I need one particular fish for my chart. Just one! Probably.",
    make: (c, r) => { const o = pickOcean(c, r); return [{ t: 'catch', n: 1, species: r.pick(SURVEY[o] || SURVEY.oscean), biome: o }]; } },
  { id: 'makeover', giver: 'marina', title: 'Home Makeover', k: 0.9, minCh: 2, text: "Redecorating day! Place a couple of things in your tank. Feng shui for fish.",
    make: () => [{ t: 'build', n: 2 }] },
  { id: 'fashion', giver: 'seal', title: 'Fashion Show', k: 0.6, minCh: 0, text: "It's Fashion Day at the pier! Change your look. Any look! I'm wearing a bubble.",
    make: () => [{ t: 'dress', n: 1 }] },
  { id: 'labshift', giver: 'fizz', title: 'Night Shift', k: 1.1, minCh: 0, text: "The Lab never sleeps! Well, I do. Finish a research project while I nap.",
    make: () => [{ t: 'labDone', n: 1 }] },
  { id: 'profit', giver: 'dot', title: 'Profit Report', k: 1, minCh: 1, text: "BEEP. Quarterly report due. Earn Aero to make the graph go up. Up is good.",
    make: (c) => [{ t: 'aero', n: DAILY_AERO[c.ch] * 6 }] },
  { id: 'stormy', giver: 'bloat', title: 'Storm Rarities', k: 1.2, minCh: 2, text: "Wild weather stirs up the good stuff! Hrrumph. Catch something fancy while the sky's acting up.",
    make: () => [{ t: 'catch', n: 1, weather: 'any', rarity: 'uncommon' }] },
];
