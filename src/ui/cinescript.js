// Quest cutscene scripts [cine21]: the set (platform, props, critters, weather, light) and the acted lines of every
// chapter opening and finale. Pure data; src/ui/questcine.js (director) and src/ui/cinestage.js (stage) play it.
//
// SETS[chId] = {
//   plat        set platform prop (cineprops.js) floating beyond the cast; crab = its crab colour variant
//   props       [[propId, owner npc]]: the owner's prop sits on the platform (the first) or on a raft by the boat
//   weather     petals | glints | snow | sparks | rain | embers | plankton (pixel particles over the scene)
//   grade       [top rgba, bottom rgba] time-of-day colour grade over the world
//   time        location card sub line (the ocean name is the card's 3D title); nightTime / nightGrade after dark
//   jumpers     species ids of the fish that leap out of the water now and then
//   gulls, penguins, jellies, eyes   background critters
// }
// Script steps (SCRIPTS[chId].intro / .finale), played in order:
//   {wide: secs}                 establishing wide shot + location card
//   {enter: npc, how}            an entrance: leap | swim | bubble | bob | zip (default per npc)
//   {prop: id}                   that npc's prop is brought on (drops / rises / floats in)
//   {fx: name, wait}             splash | sneeze | jump | gull | flask | penguin | spark | neon | rumble | eyes | crab | bubbles
//   {boss: true}                 reveal pan down to the boss silhouette, rumble, 3D "BOSS SIGHTED!"
//   {n: npc, s: text, ...}       a line. *word* = emphasis (speaker colour) + a gesture when it is typed.
//        shot  one | two | group | player | wide | prop (default: one, alternating with two)
//        to    who the speaker turns to (two-shot partner; 'player' = the angler)
//        act   speaker animation while talking; key = gesture on *emphasis*; after = once the line is typed
//        emote icon over the head (heart star sparkle question exclaim sweat anger zzz music eye crown)
//        pl    the angler reacts: wave cheer think laugh chat jump dance flex sad
//        re    {npc: anim}: listeners react;  fx: an event at the start of the line
export const SETS = {
  ch1: {
    plat: 'islet', crab: 0, props: [['bench', 'fizz']], weather: 'petals', time: 'SUNNY MORNING', nightTime: 'STARRY NIGHT', nightGrade: ['rgba(40,50,140,0.14)', 'rgba(0,0,0,0)'],
    grade: ['rgba(255,214,170,0.16)', 'rgba(255,255,255,0)'], jumpers: ['pixel', 'googly', 'zebrafish'], gulls: 2,
  },
  ch2: {
    plat: 'pier', crab: 0, props: [['workshop', 'marina']], weather: 'glints', time: 'GOLDEN HOUR', nightTime: 'BALMY NIGHT', nightGrade: ['rgba(60,40,120,0.16)', 'rgba(255,140,60,0.06)'],
    grade: ['rgba(255,186,90,0.22)', 'rgba(255,150,70,0.10)'], jumpers: ['honk', 'bananafish', 'flounder'], gulls: 3,
  },
  ch3: {
    plat: 'floe', crab: 1, props: [['captain', 'bloat'], ['bench', 'fizz']], weather: 'snow', time: 'FRESH SNOWFALL', nightTime: 'SNOWY NIGHT',
    grade: ['rgba(190,230,255,0.28)', 'rgba(230,246,255,0.16)'], jumpers: ['nootfish', 'icebabycod'], penguins: 3,
  },
  ch4: {
    plat: 'scrap', crab: 2, props: [['bench', 'fizz']], weather: 'sparks', time: 'RUSTY DUSK', nightTime: 'STATIC NIGHT', nightGrade: ['rgba(120,40,90,0.22)', 'rgba(40,20,90,0.26)'],
    grade: ['rgba(255,120,70,0.26)', 'rgba(70,30,120,0.30)'], jumpers: ['bitfish', 'glitchminnow'], gulls: 1,
  },
  ch5: {
    plat: 'pontoon', crab: 3, props: [['workshop', 'marina'], ['captain', 'bloat']], weather: 'rain', time: 'NEON NIGHT',
    grade: ['rgba(14,10,60,0.50)', 'rgba(40,10,70,0.34)'], jumpers: ['neonpunk', 'pigeonfish'], neon: true,
  },
  ch6: {
    plat: 'basalt', crab: 4, props: [['captain', 'bloat']], weather: 'embers', time: 'EMBERLIGHT',
    grade: ['rgba(70,10,10,0.38)', 'rgba(255,90,20,0.30)'], jumpers: ['fireflower', 'ashsnapper'],
  },
  ch7: {
    plat: 'glowrock', crab: 5, props: [['bench', 'fizz']], weather: 'plankton', time: 'ETERNAL NIGHT',
    grade: ['rgba(2,4,24,0.62)', 'rgba(6,2,30,0.55)'], jumpers: ['lanternfish'], jellies: 4, eyes: true,
  },
};

export const SCRIPTS = {
  ch1: {
    intro: [
      { wide: 2.5 },
      { enter: 'seal', how: 'swim' },
      { n: 'seal', s: 'Good morning, (OS)cean! Fresh water, fresh fish and a fresh *angler*!', to: 'player', act: 'wave', key: 'wiggle', emote: 'heart', pl: 'wave' },
      { fx: 'jump', at: 'seal', wait: 1.4 },
      { n: 'seal', s: 'Pfft! Even the fish want to say *hi*. Ahh... ahh... CHOO!', shot: 'one', act: 'worried', key: 'blow', fx: 'sneeze', emote: 'sweat', pl: 'laugh' },
      { enter: 'fizz', how: 'bubble' },
      { prop: 'bench' },
      { n: 'fizz', s: 'Bless you! Professor Fizz, at your service. My portable lab goes *everywhere*.', to: 'seal', act: 'wave', key: 'cheer', emote: 'sparkle', re: { seal: 'clap' } },
      { n: 'fizz', s: 'Bring me Aero Bucks and I will brew rods, tanks and gadgets. Mostly *non*-explosive!', shot: 'prop', act: 'point', fx: 'flask', emote: 'exclaim', re: { seal: 'worried' }, pl: 'jump' },
      { n: 'seal', s: 'And down at the very bottom... something HUGE keeps *spinning*.', shot: 'two', to: 'fizz', act: 'point', key: 'point', emote: 'question', pl: 'think' },
      { boss: true },
      { n: 'seal', s: 'But first things first: let\'s fill that Nano Tank. *Splash down*!', shot: 'group', act: 'clap', key: 'cheer', re: { fizz: 'cheer' }, pl: 'cheer' },
    ],
    finale: [
      { n: 'seal', s: 'You did it! The (OS)cean has a brand new *legend*!', act: 'clap', key: 'cheer', re: { fizz: 'cheer' }, pl: 'cheer' },
      { n: 'fizz', s: 'My readings agree: one hundred and ten percent *awesome*.', to: 'player', act: 'think', key: 'cheer', emote: 'sparkle', pl: 'flex' },
    ],
  },
  ch2: {
    intro: [
      { wide: 2.5 },
      { enter: 'marina', how: 'bubble' },
      { prop: 'workshop' },
      { n: 'marina', s: 'Ahoy! Welcome to the Shallows: warm water, bright fish and zero *sharks*. Mostly.', to: 'player', act: 'wave', key: 'point', emote: 'heart', pl: 'wave' },
      { fx: 'gull', wait: 1.6 },
      { n: 'marina', s: 'Shoo, Gully! That is my *anvil*, not your lunch table.', shot: 'prop', act: 'point', key: 'think', emote: 'anger', pl: 'laugh' },
      { enter: 'dot', how: 'zip' },
      { n: 'dot', s: 'BEEP BOOP! The Bait Shop is *OPEN*! Worms! Bread! Mystery goo!', to: 'player', act: 'cheer', key: 'cheer', emote: 'exclaim', pl: 'jump' },
      { enter: 'seal', how: 'leap' },
      { n: 'seal', s: 'Ooh, mystery goo! Better bait means better *fish*!', shot: 'two', to: 'dot', act: 'wiggle', key: 'cheer', emote: 'star', re: { dot: 'cheer' }, fx: 'jump' },
      { n: 'marina', s: 'Careful though. Something cranky lurks below. It once *rage-quit* a whole river.', shot: 'one', act: 'think', key: 'point', emote: 'sweat', re: { seal: 'worried' }, pl: 'think' },
      { boss: true },
      { n: 'seal', s: 'We\'ll be ready for it. Hop in the dinghy, angler: *anchors up*!', shot: 'group', act: 'clap', key: 'cheer', re: { marina: 'cheer', dot: 'cheer' }, pl: 'cheer' },
    ],
    finale: [
      { n: 'marina', s: 'Ship shape, sailor! The Shallows have never been *shinier*.', act: 'wave', key: 'cheer', pl: 'cheer' },
      { n: 'dot', s: 'BEEP! Customer satisfaction: *MAXIMUM*. Loyalty points: also maximum.', act: 'cheer', key: 'cheer', emote: 'heart', pl: 'dance' },
    ],
  },
  ch3: {
    intro: [
      { wide: 2.5 },
      { fx: 'penguin', wait: 1.2 },
      { enter: 'bloat', how: 'bob' },
      { prop: 'captain' },
      { n: 'bloat', s: 'Hrrumph! In my day we fished the Fjord with a *toothpick* and pure courage!', to: 'player', act: 'talk', key: 'cheer', emote: 'exclaim', pl: 'think' },
      { enter: 'fizz', how: 'bubble' },
      { prop: 'bench' },
      { n: 'fizz', s: 'And now we have *SCIENCE*! Heated flasks, insulated rods, the works!', to: 'bloat', act: 'cheer', key: 'cheer', emote: 'sparkle', fx: 'flask', pl: 'cheer' },
      { n: 'bloat', s: 'Science, schmience. ...Brr. Is that flask *warm*? Asking for a friend.', shot: 'one', act: 'talk', key: 'cheer', emote: 'sweat', re: { fizz: 'laugh' }, pl: 'laugh' },
      { enter: 'seal', how: 'leap' },
      { n: 'seal', s: 'Ooh, chilly! Ahh... CHOO! The penguins say a grumpy old *shark* lives down there.', shot: 'one', act: 'worried', key: 'point', fx: 'sneeze', emote: 'sweat', re: { bloat: 'cheer' } },
      { boss: true },
      { n: 'bloat', s: 'Back in my day, sharks said *please*! Go teach it some manners.', shot: 'group', act: 'cheer', key: 'cheer', re: { fizz: 'cheer', seal: 'clap' }, pl: 'flex' },
    ],
    finale: [
      { n: 'bloat', s: 'Hrrumph... I haven\'t been this proud since my very first *puff*.', act: 'cheer', key: 'cheer', emote: 'heart', pl: 'cheer' },
      { n: 'fizz', s: 'The data says the fjord fish are *chill* about it.', to: 'bloat', act: 'laugh', key: 'cheer', re: { bloat: 'cheer' }, pl: 'laugh' },
    ],
  },
  ch4: {
    intro: [
      { wide: 2.5 },
      { fx: 'spark', wait: 0.9 },
      { enter: 'fizz', how: 'bubble' },
      { prop: 'bench' },
      { n: 'fizz', s: 'Behold! A reef built from *circuits*, cogs and slightly haunted monitors!', to: 'player', act: 'cheer', key: 'cheer', emote: 'sparkle', fx: 'spark', pl: 'jump' },
      { enter: 'seal', how: 'swim' },
      { n: 'seal', s: 'It\'s a bit spooky... why is that screen *staring* at me?', shot: 'two', to: 'fizz', act: 'worried', key: 'flop', emote: 'sweat', pl: 'think' },
      { n: 'fizz', s: 'Bring me scrap and I\'ll turn it into *gadgets*. Waste not, wonder lots!', shot: 'prop', act: 'point', key: 'cheer', fx: 'flask', re: { seal: 'clap' }, emote: 'star' },
      { n: 'seal', s: 'It gets darker down there. Stay close to my *bubbles*!', shot: 'one', act: 'blow', key: 'blow', fx: 'bubbles', emote: 'heart', pl: 'nod' },
      { boss: true },
      { n: 'fizz', s: 'A fatal exception? Then we simply *reboot* it!', shot: 'group', act: 'cheer', key: 'cheer', re: { seal: 'cheer' }, pl: 'flex' },
    ],
    finale: [
      { n: 'seal', s: 'You rebooted the whole *reef*! Even the monitors are smiling!', act: 'clap', key: 'cheer', pl: 'cheer' },
      { n: 'fizz', s: 'Error 404: problems not *found*. Splendid work!', to: 'player', act: 'cheer', key: 'cheer', emote: 'sparkle', pl: 'dance' },
    ],
  },
  ch5: {
    intro: [
      { wide: 2.5 },
      { fx: 'neon', wait: 1.1 },
      { enter: 'marina', how: 'bubble' },
      { prop: 'workshop' },
      { n: 'marina', s: 'Neon lights under the waves! Fish here wear *sunglasses*. Probably.', to: 'player', act: 'wave', key: 'cheer', emote: 'star', pl: 'laugh' },
      { fx: 'crab', wait: 1.6 },
      { n: 'marina', s: 'Mind the taxi crab, it never *stops*. Not even for tips.', shot: 'prop', act: 'point', key: 'point', emote: 'sweat', pl: 'jump' },
      { enter: 'bloat', how: 'bob' },
      { prop: 'captain' },
      { n: 'bloat', s: 'Hrrumph! I knew this city when it was a *village*. A very wet one.', to: 'marina', act: 'talk', key: 'cheer', emote: 'music', re: { marina: 'laugh' }, pl: 'think' },
      { n: 'marina', s: 'There\'s a big shot in town. Thinks everyone else is an *NPC*.', shot: 'two', to: 'bloat', act: 'think', key: 'point', emote: 'anger' },
      { boss: true },
      { n: 'bloat', s: 'Then let\'s show it who the real *main character* is. You, angler!', shot: 'group', act: 'cheer', key: 'cheer', re: { marina: 'cheer' }, pl: 'flex' },
    ],
    finale: [
      { n: 'marina', s: 'The whole city is glowing a little brighter with you in *town*.', act: 'wave', key: 'cheer', emote: 'heart', pl: 'cheer' },
      { n: 'bloat', s: 'Hrrumph. You\'re the main character now. Don\'t let it go to your *fins*.', to: 'player', act: 'cheer', key: 'cheer', pl: 'flex' },
    ],
  },
  ch6: {
    intro: [
      { wide: 2.6 },
      { fx: 'rumble', wait: 1.3 },
      { enter: 'bloat', how: 'bob' },
      { prop: 'captain' },
      { n: 'bloat', s: 'Lava, vents and fish that *sizzle*. Mind your whiskers, angler!', to: 'player', act: 'talk', key: 'cheer', emote: 'exclaim', pl: 'think' },
      { enter: 'seal', how: 'leap' },
      { n: 'seal', s: 'Hot hot HOT! My paint is *bubbling*!', shot: 'one', act: 'wiggle', key: 'cheer', emote: 'sweat', fx: 'splash', pl: 'laugh' },
      { n: 'bloat', s: 'Steady now. I sailed a rift like this once. Lost both my *eyebrows*.', shot: 'two', to: 'seal', act: 'talk', key: 'cheer', re: { seal: 'worried' }, pl: 'think' },
      { n: 'seal', s: 'The deepest zone is down there somewhere. I can *smell* it!', shot: 'one', act: 'point', key: 'point', emote: 'question' },
      { boss: true },
      { n: 'bloat', s: 'It is NOT the final boss. Hrrumph. But it\'s *close*!', shot: 'group', act: 'cheer', key: 'cheer', re: { seal: 'clap' }, pl: 'flex' },
    ],
    finale: [
      { n: 'seal', s: 'We survived the lava! My party hat only melted a *little*.', act: 'wiggle', key: 'cheer', emote: 'sweat', pl: 'laugh' },
      { n: 'bloat', s: 'Hrrumph! Eyebrows all intact? Good. Then that\'s a *legend* in the making.', to: 'player', act: 'cheer', key: 'cheer', pl: 'cheer' },
    ],
  },
  ch7: {
    intro: [
      { wide: 2.7 },
      { fx: 'eyes', wait: 1.4 },
      { enter: 'seal', how: 'swim' },
      { n: 'seal', s: 'This is it. The *Deep* Ocean. Glowing eyes everywhere...', to: 'player', act: 'worried', key: 'flop', emote: 'sweat', pl: 'think' },
      { enter: 'bloat', how: 'bob' },
      { n: 'bloat', s: 'They say a legend sleeps at the bottom. Hrrumph. Has done for *ages*.', shot: 'two', to: 'seal', act: 'talk', key: 'cheer', emote: 'zzz', re: { seal: 'worried' } },
      { enter: 'fizz', how: 'bubble' },
      { prop: 'bench' },
      { n: 'fizz', s: 'Fear not! I brought a *glow-in-the-dark* lab. For science. And night lights.', shot: 'prop', act: 'cheer', key: 'cheer', fx: 'flask', emote: 'sparkle', re: { seal: 'clap' }, pl: 'laugh' },
      { n: 'seal', s: 'Whatever is down there... it has been *watching* us all along.', shot: 'one', act: 'point', key: 'point', emote: 'eye', pl: 'jump' },
      { boss: true },
      { n: 'seal', s: 'Stay brave, angler. We are right *behind* you!', shot: 'group', act: 'clap', key: 'cheer', re: { bloat: 'cheer', fizz: 'cheer' }, pl: 'cheer' },
    ],
    finale: [
      { n: 'seal', s: 'The legend at the bottom of the sea... it was *YOU* all along!', act: 'clap', key: 'cheer', emote: 'heart', pl: 'cheer' },
      { n: 'bloat', s: 'I\'ll be telling this tale for a hundred *tides*. Hrrumph!', act: 'cheer', key: 'cheer', re: { seal: 'clap' }, pl: 'dance' },
    ],
  },
};

// default entrance per npc
export const ENTRY = { seal: 'leap', bloat: 'bob', fizz: 'bubble', marina: 'bubble', dot: 'zip' };
// default gesture on an *emphasised* word
export const KEY_ACT = { seal: 'wiggle', fizz: 'cheer', marina: 'point', bloat: 'cheer', dot: 'cheer' };
// time-of-day / weather icon for the location card
export const TIME_ICON = { petals: 'sun', glints: 'sun', snow: 'cloud', sparks: 'cloud', rain: 'rain', embers: 'sun', plankton: 'moon' };
