import { clamp, rand, choice } from './utils';
import songs from './songs';
import CPlayer from './player-small';

const konamiCode = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
let konamiIndex = 0;

// GAMEPLAY VARIABLES

const LOADING_SCREEN = 0;
const TITLE_SCREEN = 1;
const LEVEL_SCREEN = 2;
const GAME_SCREEN = 3;
const END_SCREEN = 4;
let screen = LOADING_SCREEN;

let lost = false;
let won = false;
let currentLevel = 0;
let levels;
let hero;
let entities;
let raised = [];
let looseCondition;
let winCondition;
let endTime;
let nbSubSunk = 0;
// no-op player in case the songs fail to load
let konamiAudio = { play: () => {} };
let musicAudio = { play: () => {} };

const FRIEND_GROUP = 1;
const ENEMY_GROUP = 2;

const RADIAN = 180 / Math.PI;

// COMPONENTS

function Input() {
  this.left = 0;
  this.right = 0;
  this.up = 0;
  this.down = 0;
}

function Strategy(type, nextSteering, nextAttack) {
  this.type = type;
  this.target = undefined;
  // TODO remove when 'random' isn't a thing anymore
  this.nextSteering = nextSteering || 0.5;
  this.remainingBeforeSteering = 0;
  this.nextAttack = nextAttack || 1;
  this.remainingBeforeAttack = 0;
}

function Velocity(speed, dx = 0, dy = 0, dr = 0) {
  this.speed = speed;
  this.dx = dx;
  this.dy = dy;
  this.dr = dr;
}

function Position(x, y, r = 0) {
  this.x = x;
  this.y = y;
  this.r = r;
}

function Collision(collide, killable, radius, group) {
  this.collide = collide;
  this.killable = killable;
  this.radius = radius;
  this.group = group; // integer indicating if the entity is a friend or a group, so torpedoes can lock on the right kind of entity
}

function Ttl(time) {
  this.timeLeft = time;
}

function Sprite(alwaysRender, renderer, radarRenderer, debrisRenderer) {
  this.alwaysRender = alwaysRender;
  this.renderer = renderer;
  this.radarRenderer = radarRenderer;
  this.debrisRenderer = debrisRenderer;
}

// RENDER VARIABLES

const RATIO = 16 / 10;
const CTX = c.getContext('2d');         // visible canvas
const BUFFER = c.cloneNode();           // visible portion of map
const BUFFER_CTX = BUFFER.getContext('2d');
const TILESET = c.cloneNode();
const TILESET_CTX = TILESET.getContext('2d');

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789.:!-%,/#';
const CHARSET_ATLAS = {};
const CHARSET_SIZE = 8; // in px

for (let i = 0; i < ALPHABET.length; i++) {
  CHARSET_ATLAS[ALPHABET[i]] = i * CHARSET_SIZE;
}

const ALIGN_LEFT = 0;
const ALIGN_CENTER = 1;
const ALIGN_RIGHT = 2;

const DASH_FRAME_DURATION = 0.1; // duration of 1 animation frame, in seconds
let charset = '';   // alphabet sprite, filled in by build script, overwritten at runtime
let animationTime = 0;

// LOOP VARIABLES

let currentTime;
let elapsedTime;
let lastTime;
let requestId;
let running = true;

// onresize() must have been called first as this relies on BUFFER.width/height
function initLevels() {
  levels = [
    // #1 (tutorial)
    {
      mission: [
        'enemy mine drifted into perimeter. destroy it.',
        'turn off sonar to evade homing torpedos.'
      ],
      looseCondition: [
        ['player', BUFFER.width * 2 / 3, BUFFER.height * 2 / 3],
      ],
      otherEntities: [
        ['rock', BUFFER.width / 2 - BUFFER.width / 60, BUFFER.height / 2 - BUFFER.width / 60]
      ],
      winCondition: [
        ['mine', BUFFER.width / 3, BUFFER.height / 3],
      ],
    },
    // #2
    {
      mission: [
        'enemy subs entered perimeter. sink them all.',
      ],
      looseCondition: [
        ['player', BUFFER.width / 2, BUFFER.height / 2],
      ],
      otherEntities: [ ],
      winCondition: [
        ['sub', 100, 100],
        ['sub', 100, BUFFER.height - 100],
        ['sub', BUFFER.width - 100, 100],
        ['sub', BUFFER.width - 100, BUFFER.height - 100],
      ],
    },
    // #3
    {
      mission: [
        'enemy sub broke down in perimeter. eliminate it.',
        'enemy mines detected, proceed with caution',
      ],
      looseCondition: [
        ['player', BUFFER.width * 0.75, BUFFER.height * 0.75],
      ],
      otherEntities: [
        ['mine', BUFFER.width * 0.25, BUFFER.height * 0.25],
        ['mine', BUFFER.width * 0.25, BUFFER.height * 0.5],
        ['mine', BUFFER.width * 0.5, BUFFER.height * 0.25],
        ['mine', BUFFER.width * 0.5, BUFFER.height * 0.5],
      ],
      winCondition: [
        ['sub_disabled', BUFFER.width / 3, BUFFER.height / 3],
      ],
    },
  ];
};

// GAMEPLAY HANDLERS

function hydrate([ type, x, y ]) {
  switch (type) {
    case 'player':
      return createEntity(type, {
        collision: new Collision(true, konamiIndex !== konamiCode.length, 7, FRIEND_GROUP),
        input: new Input(),
        position: new Position(x, y),
        velocity: new Velocity(40),
        sprite: new Sprite(true, renderPlayerSub, renderPlayerRadar, () => renderDebris('rgb(75,190,250)')),
      });;
    case 'sub':
      return createEntity(type, {
        collision: new Collision(true, true, 7, ENEMY_GROUP),
        input: new Input(),
        position: new Position(x, y),
        velocity: new Velocity(20),
        strategy: new Strategy('patrol', 0.1, 1.5),
        sprite: new Sprite(false, renderEnemySub, renderEnemySubRadar, () => renderDebris('rgb(230,90,100)')),
      });
    case 'sub_disabled':
      return createEntity(type, {
        collision: new Collision(true, true, 7, ENEMY_GROUP),
        input: new Input(),
        position: new Position(x, y),
        velocity: new Velocity(20),
        strategy: new Strategy('random', 0.25),
        sprite: new Sprite(false, renderEnemySub, renderEnemySubRadar, () => renderDebris('rgb(230,90,100)')),
      });
    case 'mine':
      return createEntity(type, {
        collision: new Collision(true, true, 9, ENEMY_GROUP),
        position: new Position(x, y),
        velocity: new Velocity(25, 0, 0, 1),
        strategy: new Strategy('guard', 0, 5),
        sprite: new Sprite(false, renderEnemyMine, renderEnemyMineRadar, () => renderDebris('rgb(230,90,100)')),
      });
    case 'rock':
      return createEntity(type, {
        collision: new Collision(true, false, 75),
        position: new Position(x, y),
        velocity: new Velocity(0),
        sprite: new Sprite(true, renderRock),
      });
  }
}

// really start level
function startGame() {
  endTime = 0;

  const level = levels[currentLevel];
  looseCondition = [...level.looseCondition.map(hydrate)];
  // hero is always the 1st loose condition
  hero = looseCondition[0];
  winCondition = level.winCondition.map(hydrate);
  entities = [
    ...level.otherEntities.map(hydrate),
    ...looseCondition,
    ...winCondition,
  ];

  screen = GAME_SCREEN;
};

function restartGame() {
  won = lost = false;
  if (currentLevel >= levels.length) {
    konamiIndex = 0;
    screen = TITLE_SCREEN;
  } else {
    screen = LEVEL_SCREEN;
  }
}

function createEntity(type, components) {
  return {
    ...components,
    echo: { ...components.position },
    online: true,
    type,
  };
};

function maintainWorld() {
  // remove dead entities
  entities = entities.filter(({ dead }) => !dead);
  // add raised entities
  if (raised.length > 0) {
    raised.forEach(entity => entities.push(entity));
    raised = [];
  }
}

function distanceSquare({ x: x1, y: y1 }, { x: x2, y: y2 }) {
  return Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2);
};

function inRange(position1, position2, distance) {
  return Math.pow(distance, 2) > distanceSquare(position1, position2);
};

function testCircleCollision(entity1, entity2) {
  const { position: position1, collision: collision1 } = entity1;
  const { position: position2, collision: collision2 } = entity2;
  return (
    collision1.collide
    && collision2.collide
    && inRange(position1, position2, collision1.radius + collision2.radius)
  );
};

function constrainToViewport(entity) {
  const { position, collision } = entity;
  position.x = clamp(position.x, 0, BUFFER.width - collision.radius)
  position.y = clamp(position.y, 0, BUFFER.height - collision.radius)
};

function fireTorpedo({ position: subPos }, group) {
  const strategy = new Strategy('cruise');
  const collision = new Collision(true, true, 5, group);
  const sprite = new Sprite(false, renderTorpedo, renderTorpedoRadar, () => renderDebris('rgb(220,240,150)'));
  const ttl = new Ttl(30);
  // send torpedo in same direction as sub is moving/facing
  const dx = calcDxVelocity(subPos, -1);
  const dy = calcDyVelocity(subPos, -1);

  // place torpedo ahead of sub so it doesn't immediately collide with it
  let x = subPos.x + 20*dx;
  let y = subPos.y + 20*dy;

  const position = new Position(x, y, subPos.r);
  const velocity = new Velocity(60, dx, dy);
  const torpedo = createEntity('torpedo', { collision, position, sprite, strategy, ttl, velocity });
  raised.push(torpedo);
  return torpedo;
};

function collideEntity(entity) {
  if (entity.collision.killable) {
    // mark entity for removal at end of update() loop
    entity.dead = true;
    if (entity !== hero && entity.type !== 'torpedo') {
      nbSubSunk++;
    }

    // add 3 debris in place of entity
    const { position: { x, y }, velocity: { dx, dy, speed } } = entity;
    const collision = new Collision(false, false);
    const sprite = new Sprite(true, entity.sprite.debrisRenderer);

    [1,2,3].forEach(function(i) {
      const position = new Position(x, y);
      const velocity = new Velocity(
        speed,
        dx / 2 + rand(-2, 2) / 10,
        dy / 2 + rand(-2, 2) / 10,
        rand(1, i+1) * (i%2 ? 1 : -1)
      );
      const ttl = new Ttl(rand(20, 50) / 10);
      raised.push(createEntity('debris', { collision, position, sprite, ttl, velocity }));
    });
  }
};

function isEnemy(group) {
  return ({ collision}) => !!collision.group && collision.group !== group;
};

// does the current strategy still make sense or should it change to something else?
function refreshStrategy(entity) {
  const { strategy, position, collision: { group } } = entity;
  if (strategy) {
    switch (strategy.type) {
      case 'patrol':
        // pick a new destination if there is none or it's been reached or if the target is offline
        if (!strategy.target || inRange(position, strategy.target.echo, 15) || !strategy.target.online) {
          entity.strategy.patrolLocked = false;
          strategy.target = {
            echo: new Position(rand(0, BUFFER.width), rand(0, BUFFER.height)),
          }
        };
        // or lockon any enemy within range
        getEnemiesSortedByDistance(entity).forEach(function(enemy) {
          if (enemy.online && !entity.strategy.patrolLocked && inRange(position, enemy.echo, 100)) {
            entity.strategy.target = enemy;
            entity.strategy.patrolLocked = true;
          }
        });
        break;
      case 'lockon':
        const { online, dead } = strategy.target;
        // if target has been already destroyed, or has gone offline, or has exited the radar...
        // TODO 10px should be in a constant of some kind
        if (dead || !online) {
          // ...switch back to moving in a straight line
          entity.strategy = {
            ...strategy,
            type: 'cruise',
            target: undefined,
            nextSteering: 0.5,
            remainingBeforeSteering: 0,
          };
          entity.input = null;
          entity.velocity.dr = 0;
        }
        break;
      case 'cruise':
        // torpedoes can only lock on enemy entities
        getEnemiesSortedByDistance(entity).forEach(function(enemy) {
          // TODO 200 works for torpedos right now, but might need to change when applied to enemy sub range
          if (isWithinRadar(entity, enemy, 200, 45)) {
            entity.strategy = {
              ...strategy,
              type: 'lockon',
              target: enemy,
              nextSteering: 0.1,
              remainingBeforeSteering: 0,
            };
            strategy.target = enemy;
            entity.input = new Input();
          }
        });
        break;
    }
  }
};


function angleDifference({ position, velocity }, { echo }) {
  return angleDifference2DVectors({ x: velocity.dx, y: velocity.dy }, { x: echo.x - position.x, y: echo.y - position.y })
};

function angleTo({ x, y }) {
  return Math.atan2(y, x) * RADIAN;
}

// between 2 vectors, in degree and in range [-180, 180]
function angleDifference2DVectors({ x: x1, y: y1 }, { x: x2, y: y2}) {
  return (((Math.atan2(y2, x2) - Math.atan2(y1, x1)) * RADIAN + 180) % 360) - 180;
};

function isWithinRadar(entity, enemy, radius, angle) {
  const { position } = entity;
  const { echo } = enemy;
  return inRange(position, echo, radius) && Math.abs(angleDifference(entity, enemy)) < angle / 2;
}

function getEnemiesSortedByDistance({ position, collision: { group } }) {
  return entities
    .filter(isEnemy(group))
    .sort(({ position: position1 }, { position: position2 }) => {
      const d1 = distanceSquare(position1, position);
      const d2 = distanceSquare(position2, position);
      return d1 < d2 ? -1 : d1 > d2 ? 1 : 0;
    })
}

// change direction, fire a torpedo or whatever
function applyStrategy(entity) {
  const { input, strategy, position, collision: { group } } = entity
  if (strategy) {
    strategy.remainingBeforeSteering -= elapsedTime;
    if (strategy.remainingBeforeSteering < 0) {
      strategy.remainingBeforeSteering += strategy.nextSteering;

      // steering
      switch (strategy.type) {
        case 'patrol':
        case 'lockon':
          const angle = angleDifference(entity, strategy.target);
          input.left = angle < -5 ? -1 : 0;
          input.right = angle > 5 ? 1 : 0;
          input.up = -1;
          input.down = 0;
          break;
        case 'random':
          input.up = choice([-1, 0]);
          input.left = choice([-1, 0]);
          input.right = choice([1, 0]);
          input.down = choice([1, 0]);
          break;
      }
    }

    strategy.remainingBeforeAttack -= elapsedTime;
    if (strategy.remainingBeforeAttack < 0) {
      strategy.remainingBeforeAttack += strategy.nextAttack;
      strategy.readyToFire = true;
    }

    if (strategy.readyToFire) {
      switch (strategy.type) {
        case 'patrol':
          getEnemiesSortedByDistance(entity).forEach(function(enemy) {
            const { online } = enemy;
            // TODO 200 same as radar size, should come from a prop
            if (online && strategy.readyToFire && isWithinRadar(entity, enemy, 200, 45))  {
              const torpedo = fireTorpedo(entity, entity.collision.group);
              // both the sub and the torpedo lock onto the enemy
              strategy.target = enemy;
              strategy.readyToFire = false;
              strategy.remainingBeforeAttack = strategy.nextAttack;
            }
          });
          break;
        case 'guard':
          // mines can only fire on enemy entities
          getEnemiesSortedByDistance(entity).forEach(function(enemy) {
            const { echo } = enemy;
            // TODO 250 same as radar size, should come from a prop
            if (enemy.online && strategy.readyToFire && inRange(position, echo, 250))  {
              const currentAngle = position.r;
              position.r = angleDifference(entity, enemy) + 90;
              fireTorpedo(entity, group);
              position.r = currentAngle;
              strategy.readyToFire = false;
              strategy.remainingBeforeAttack = strategy.nextAttack;
            }
          });
          break;
      }
    }
  }
};

function calcDxVelocity({ r }, radius) {
  return Math.sin(-r / RADIAN) * radius;
};

function calcDyVelocity({ r }, radius) {
  return Math.cos(-r / RADIAN) * radius;
};

function applyInputToVelocity({ input, position, velocity }) {
  if (input) {
    velocity.dr = input.left + input.right;
    velocity.dx = calcDxVelocity(position, input.up + input.down);
    velocity.dy = calcDyVelocity(position, input.up + input.down);
  }
};

function applyVelocityToPosition({ velocity, position }) {
  const distance = velocity.speed * elapsedTime;
  position.x += distance * velocity.dx;
  position.y += distance * velocity.dy;
  position.r = (position.r + distance * velocity.dr) % 360;
};

function applyPositionToEcho({ position, echo, sprite, online }) {
  if (hero.online && online) {
    echo.x = position.x;
    echo.y = position.y;
    echo.r = position.r;
  }
};

function applyElapsedTimeToTtl(entity) {
  let {ttl} = entity;
  if (ttl) {
    ttl.timeLeft -= elapsedTime;
    if (ttl.timeLeft < 1) {
      // kill entities with zero/negative time to live
      entity.dead = true;
    }
  }
};

function checkEndGame() {
  if (lost || won) {
    endTime += elapsedTime;
  } else {
    lost = looseCondition.length === looseCondition.filter(({ dead }) => dead).length;
    won = winCondition.length === winCondition.filter(({ dead }) => dead).length;
  }

  if (endTime > 4) {
    if (won) {
      currentLevel += 1;
    }
    screen = END_SCREEN;
  }
};

function update() {
  switch (screen) {
    case GAME_SCREEN:
      entities.forEach((entity) => {
        refreshStrategy(entity);
        applyStrategy(entity);
        applyInputToVelocity(entity);
        applyVelocityToPosition(entity);
        applyPositionToEcho(entity);
        applyElapsedTimeToTtl(entity);
        constrainToViewport(entity);
      });
      // detect collisions
      let collisions = new Set();
      entities.forEach((entity1, n) => {
        entities.slice(n + 1).forEach((entity2) => {
          if (testCircleCollision(entity1, entity2)) {
            collisions.add(entity1);
            collisions.add(entity2);
          }
        });
      });
      // apply collisions
      collisions.forEach(collideEntity);
      // expire dead entities
      maintainWorld();
      checkEndGame();
      break;
  }
};

// SOUND HANDLERS

function loadSong(song, name) {
  console.log(`loading ${name}...`);

  const player = new CPlayer();
  player.init(song);

  let loaded = 0;
  while (loaded < 1) {
    loaded = player.generate();
    console.log(`loaded ${loaded * 100}%`);
  }

  let wave = player.createWave();
  return [
    document.createElement('audio'),
    URL.createObjectURL(new Blob([wave], {type:'audio/wav'})),
  ]
}

async function initSound() {
  let [audio, data] = loadSong(songs.konamiCode, 'secret song');
  konamiAudio = audio;
  konamiAudio.src = data;

  [audio, data] = loadSong(songs.markSparlingSong, 'Mark Sparling\'s song');
  musicAudio = audio;
  musicAudio.src = data;
  musicAudio.loop = true;
}

// RENDER HANDLERS

function blit() {
  // copy backbuffer onto visible canvas, scaling it to screen dimensions
  CTX.drawImage(
    BUFFER,
    0, 0, BUFFER.width, BUFFER.height,
    0, 0, c.width, c.height
  );
};

function render() {
  BUFFER_CTX.fillStyle = 'rgb(20,35,40)';
  BUFFER_CTX.fillRect(0, 0, BUFFER.width, BUFFER.height);

  switch (screen) {
    case LOADING_SCREEN:
      renderText(`loading${animationTime < 0.25 ? '' : animationTime < 0.5 ? '.' : animationTime < 0.75 ? '..' : '...'}`, BUFFER.width / 2, BUFFER.height / 2, ALIGN_CENTER);
      break;
    case TITLE_SCREEN:
      renderGrid();
      renderText('js13kgames 2018', BUFFER.width / 2, 2*CHARSET_SIZE, ALIGN_CENTER);
      renderTitle();
      renderText('move: arrows/wasd', 2*CHARSET_SIZE, BUFFER.height / 2 - 2*CHARSET_SIZE, ALIGN_LEFT);
      renderText('torpedo: space', 2*CHARSET_SIZE, BUFFER.height / 2, ALIGN_LEFT);
      renderText('sonar: f/o', 2*CHARSET_SIZE, BUFFER.height / 2 + 2*CHARSET_SIZE, ALIGN_LEFT);
      renderText('game: jerome lecomte', BUFFER.width - 2*CHARSET_SIZE, BUFFER.height / 2 - CHARSET_SIZE, ALIGN_RIGHT);
      renderText('music: mark sparling', BUFFER.width - 2*CHARSET_SIZE, BUFFER.height / 2 + CHARSET_SIZE, ALIGN_RIGHT);
      if (animationTime > 0.4) {
        renderText('press any key to start', BUFFER.width / 2, BUFFER.height - 3*CHARSET_SIZE, ALIGN_CENTER);
      }
      break;
      case LEVEL_SCREEN:
      renderText(`mission #0${currentLevel+1}`, BUFFER.width / 2, BUFFER.height / 2 - 2*CHARSET_SIZE, ALIGN_CENTER);
      levels[currentLevel].mission.forEach((instruction, i) => {
        renderText(instruction, BUFFER.width / 2, BUFFER.height / 2 + i*2*CHARSET_SIZE, ALIGN_CENTER);
      });
      if (animationTime > 0.4) {
        renderText('press any key to start mission', BUFFER.width / 2, BUFFER.height - 3*CHARSET_SIZE, ALIGN_CENTER);
      }
      break;
    case GAME_SCREEN:
      // uncomment to debug mobile input handlers
      // renderDebugTouch();
      renderGrid();
      entities.forEach(renderRadar);
      entities.forEach(renderEntity);
      renderText(`sonar: ${hero.online ? 'on' : 'off'}line`, BUFFER.width / 2, 2*CHARSET_SIZE, ALIGN_CENTER);
      break;
    case END_SCREEN:
      if (currentLevel >= levels.length) {
        renderTitle();
        renderText('you finished submersible warship 2063', BUFFER.width / 2, BUFFER.height * 0.25 + 2*CHARSET_SIZE, ALIGN_CENTER);
        renderText('thank you for playing!', BUFFER.width / 2, BUFFER.height * 0.25 + 4*CHARSET_SIZE, ALIGN_CENTER);
        renderText('press t to tweet your score', BUFFER.width / 2, BUFFER.height * 0.75, ALIGN_CENTER);
      } else if (won) {
        // by this time currentLevel has already been increased by 1
        renderText(`mission #0${currentLevel} complete`, BUFFER.width / 2, BUFFER.height / 2, ALIGN_CENTER);
        if (animationTime > 0.4) {
          renderText('press any key to start next mission', BUFFER.width / 2, BUFFER.height - 3*CHARSET_SIZE, ALIGN_CENTER);
        }
      } else {
        renderText('you died!', BUFFER.width / 2, BUFFER.height / 2, ALIGN_CENTER);
        if (animationTime > 0.4) {
          renderText('press any key to try again', BUFFER.width / 2, BUFFER.height - 3*CHARSET_SIZE, ALIGN_CENTER);
        }
      }
      break;
  }

  blit();
};

async function initTileset() {
  TILESET.width = TILESET.height = 64;
  // cross for tactical grid
  TILESET_CTX.strokeStyle = 'rgb(40,55,50)';
  TILESET_CTX.beginPath();
  TILESET_CTX.moveTo(0, 4);
  TILESET_CTX.lineTo(8, 4);
  TILESET_CTX.stroke();
  TILESET_CTX.closePath();
  TILESET_CTX.beginPath();
  TILESET_CTX.moveTo(4, 0);
  TILESET_CTX.lineTo(4, 8);
  TILESET_CTX.stroke();
  TILESET_CTX.closePath();
};

function renderTitle() {
  BUFFER_CTX.save();
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.strokeStyle = 'rgb(70,105,105)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle;
  BUFFER_CTX.fillStyle = 'rgba(30,60,60,0.5)';
  // S
  BUFFER_CTX.translate(BUFFER.width / 2 - 100, BUFFER.height / 2);
  BUFFER_CTX.save();
  BUFFER_CTX.scale(0.8, 0.8);
  BUFFER_CTX.rotate(35 / RADIAN);
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(0, 10);
  BUFFER_CTX.arc(0, 10, 20, Math.PI * 1.5, Math.PI * 0.5);
  BUFFER_CTX.arc(0, -10, 20, Math.PI * 0.5, Math.PI * 1.5);
  BUFFER_CTX.closePath();
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
  BUFFER_CTX.moveTo(0, 0);
  BUFFER_CTX.restore();
  // U
  BUFFER_CTX.translate(38, 0);
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, 5, 15, Math.PI * 2, Math.PI);
  BUFFER_CTX.moveTo(15, 5);
  BUFFER_CTX.lineTo(15, -20);
  BUFFER_CTX.lineTo(-15, -20);
  BUFFER_CTX.lineTo(-15, 5);
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  BUFFER_CTX.moveTo(0, 0);
  // B
  BUFFER_CTX.translate(40, 0);
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, -10, 10, Math.PI * 1.5, Math.PI * 0.5);
  BUFFER_CTX.moveTo(0, -20);
  BUFFER_CTX.lineTo(-15, -20);
  BUFFER_CTX.lineTo(-15, 20);
  BUFFER_CTX.lineTo(0, 20);
  BUFFER_CTX.moveTo(0, 0);
  BUFFER_CTX.arc(0, 10, 10, Math.PI * 1.5, Math.PI * 0.5);
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  BUFFER_CTX.moveTo(0, 0);
  // W
  BUFFER_CTX.translate(40, 0);
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(0, 0);
  BUFFER_CTX.lineTo(7.5, 20);
  BUFFER_CTX.lineTo(22.5, -20);
  BUFFER_CTX.lineTo(-22.5, -20);
  BUFFER_CTX.lineTo(-7.5, 20);
  BUFFER_CTX.lineTo(7.5, -20);
  // BUFFER_CTX.moveTo(-10, -20);
  // BUFFER_CTX.lineTo(10, 20);
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  // A
  BUFFER_CTX.translate(35, 0);
  BUFFER_CTX.moveTo(0, 0);
  BUFFER_CTX.beginPath();
  BUFFER_CTX.lineTo(0, -20);
  BUFFER_CTX.lineTo(-15, 20);
  BUFFER_CTX.lineTo(15, 20);
  BUFFER_CTX.lineTo(0, -20);
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  // R
  BUFFER_CTX.translate(40, 0);
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, -10, 10, Math.PI * 1.5, Math.PI * 0.5);
  BUFFER_CTX.moveTo(0, -20);
  BUFFER_CTX.lineTo(-15, -20);
  BUFFER_CTX.lineTo(-15, 20);
  BUFFER_CTX.lineTo(10, 20);
  BUFFER_CTX.lineTo(0, 0);
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  BUFFER_CTX.moveTo(0, 0);
  // 2063
  BUFFER_CTX.translate(-100, 70);
  BUFFER_CTX.font = '54px Arial';
  BUFFER_CTX.textAlign = 'center';
  BUFFER_CTX.textBase = 'bottom';
  BUFFER_CTX.fillText('2063', 0, 0);
  BUFFER_CTX.strokeText('2063', 0, 0);
  BUFFER_CTX.restore();
};

function renderCountdown() {
  const minutes = Math.floor(Math.ceil(countdown) / 60);
  const seconds = Math.ceil(countdown) - minutes * 60;
  renderText(`${minutes}:${seconds <= 9 ? '0' : ''}${seconds}`, BUFFER.width - CHARSET_SIZE, CHARSET_SIZE, ALIGN_RIGHT);
};

function renderGrid() {
  BUFFER_CTX.fillStyle = BUFFER_CTX.createPattern(TILESET, 'repeat');
  BUFFER_CTX.fillRect(0, 0, BUFFER.width, BUFFER.height);
};

function getRenderPosition(position, echo, alwaysRender) {
  return alwaysRender ? position : echo;
}

function renderEntity({ position, echo, sprite }) {
  const pos = getRenderPosition(position, echo, sprite.alwaysRender);

  BUFFER_CTX.save();

  BUFFER_CTX.translate(Math.round(pos.x), Math.round(pos.y));
  BUFFER_CTX.rotate(pos.r / RADIAN);

  sprite.renderer();

  BUFFER_CTX.restore();
};

function renderPlayerSub() {
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.fillStyle = 'rgb(75,190,250)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.fillStyle;
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, 2, 5, 0, Math.PI*2);
  BUFFER_CTX.fillRect(-2, -10, 4, 12);
  BUFFER_CTX.fill();
  BUFFER_CTX.closePath();
};

function renderTorpedo() {
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.strokeStyle = hero.online ? 'rgb(220,240,150)' : 'rgb(80,100,80)';
  BUFFER_CTX.lineWidth = 3;
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle;
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(0, -6);
  BUFFER_CTX.lineTo(0, 2);
  BUFFER_CTX.stroke();
  BUFFER_CTX.moveTo(0, 4);
  BUFFER_CTX.lineTo(0, 6);
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
};

function renderEnemySub() {
  BUFFER_CTX.beginPath();
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.fillStyle = hero.online ? 'rgb(230,90,100)' : 'rgb(55,40,35)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.fillStyle;
  BUFFER_CTX.fillRect(-5, -3, 10, 10);
  BUFFER_CTX.fillRect(-2, -10, 4, 12);
  BUFFER_CTX.fill();
  BUFFER_CTX.closePath();
};

function renderEnemyMine() {
  BUFFER_CTX.lineWidth = 2;
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.fillStyle = BUFFER_CTX.strokeStyle = hero.online ? 'rgb(230,90,100)' : 'rgb(55,40,35)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.fillStyle;
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, 0, 4, 0, 2*Math.PI);
  BUFFER_CTX.fill();
  BUFFER_CTX.setLineDash([2, 4]);
  BUFFER_CTX.arc(0, 0, 6, 0, 2*Math.PI);
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
};

function renderDebris(color) {
  BUFFER_CTX.beginPath();
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.fillStyle = color;
  BUFFER_CTX.shadowColor = BUFFER_CTX.fillStyle;
  BUFFER_CTX.moveTo(-5, -10);
  BUFFER_CTX.lineTo(5, 0);
  BUFFER_CTX.lineTo(-4, -2);
  BUFFER_CTX.fill();
  BUFFER_CTX.closePath();
};

function renderRock() {
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.strokeStyle = 'rgb(70,105,105)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle;
  BUFFER_CTX.fillStyle = 'rgba(30,60,60,0.5)';
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(0, -70);
  [
    [-25, -73],
    [-35, -35],
    [-70, -30],
    [-70, -25],
    [-70, -25],
    [-65, 0],
    [-25, 12],
    [-5, 65],
    [12, 73],
    [25, 50],
    [55, 45],
    [75, 0],
    [60, -45],
    [35, -40],
    [38, -71],
    [0, -69],
  ].forEach(function([x, y]) {
    BUFFER_CTX.lineTo(x, y);
  });
  BUFFER_CTX.closePath();
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(-50, 20);
  [
    [-70, 25],
    [-50, 50],
    [-25, 50],
    [-25, 25],
  ].forEach(function([x, y]) {
    BUFFER_CTX.lineTo(x, y);
  });
  BUFFER_CTX.closePath();
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
};

// FIXME need a getPosition that returns either echo or position based on value of sprite.alwaysRender
// to be used in renderRadar/renderEntity and their derivative... make that a new component...
function renderRadar(entity) {
  const { position, echo, sprite } = entity;
  if (sprite.radarRenderer) {
    const pos = getRenderPosition(position, echo, sprite.alwaysRender);

    BUFFER_CTX.save();
    BUFFER_CTX.translate(Math.round(pos.x), Math.round(pos.y));

    sprite.radarRenderer(entity);

    BUFFER_CTX.restore();
  }
};

function renderTorpedoRadar({ position, echo, sprite }) {
  const pos = getRenderPosition(position, echo, sprite.alwaysRender);
  // lockon radar
  BUFFER_CTX.rotate(pos.r / RADIAN);
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.strokeStyle = hero.online ? 'rgb(220,240,150)' : 'rgb(80,100,80)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle;
  BUFFER_CTX.fillStyle = hero.online ? 'rgba(80,100,80,0.15)': 'rgba(80,100,80,0.25)';
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(-4, 0);
  BUFFER_CTX.arc(0, 0, 200, -Math.PI*5/8, -Math.PI*3/8);
  BUFFER_CTX.lineTo(4, 0);
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
};

function renderPlayerRadar(entity) {
  const { dashOffset = 0, dashTime = 0 } = entity;
  // radar
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.strokeStyle = 'rgb(70,105,105)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle;
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, 0, 100, 0, Math.PI*2);
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  // proximity alert
  BUFFER_CTX.beginPath();
  BUFFER_CTX.lineDashOffset = dashOffset;
  BUFFER_CTX.setLineDash([4, 8]);
  BUFFER_CTX.arc(0, 0, 40, 0, Math.PI*2);
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  // TODO should be done in update()
  entity.dashTime = dashTime + elapsedTime;
  if (entity.dashTime > DASH_FRAME_DURATION) {
    entity.dashTime -= DASH_FRAME_DURATION;
    entity.dashOffset = (dashOffset-1) % 12;  // next line dash: 4, 8, 12 <- offset
  }
};

function renderEnemySubRadar({ position, echo, sprite }) {
  // lockon radar
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle = 'rgb(55,40,35)';
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, 0, 100, 0, Math.PI*2);
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  // attack radar
  const pos = getRenderPosition(position, echo, sprite.alwaysRender);
  BUFFER_CTX.save();
  BUFFER_CTX.rotate(pos.r / RADIAN);
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(-4, 0);
  BUFFER_CTX.arc(0, 0, 200, -Math.PI*5/8, -Math.PI*3/8);
  BUFFER_CTX.lineTo(4, 0);
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
  BUFFER_CTX.restore();

};

function renderEnemyMineRadar() {
  // attack radar
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.strokeStyle = 'rgb(55,40,35)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle;
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, 0, 250, 0, Math.PI*2);
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
};

function renderText(msg, x, y, align = ALIGN_LEFT, scale = 1) {
  const SCALED_SIZE = scale * CHARSET_SIZE;
  const MSG_WIDTH = msg.length * SCALED_SIZE;
  const ALIGN_OFFSET =
    align === ALIGN_RIGHT ? MSG_WIDTH :
    align === ALIGN_CENTER ? MSG_WIDTH / 2 :
    0;
  [...msg].forEach((c, i) => {
    if (c in CHARSET_ATLAS) {
      BUFFER_CTX.drawImage(
        charset,
        CHARSET_ATLAS[c], 0, CHARSET_SIZE, CHARSET_SIZE,
        x + i*SCALED_SIZE - ALIGN_OFFSET, y, SCALED_SIZE, SCALED_SIZE
      );
    }
  });
};

// LOOP HANDLERS

function loop() {
  if (running) {
    requestId = requestAnimationFrame(loop);
    render();
    currentTime = Date.now();
    elapsedTime = (currentTime - lastTime) / 1000;
    animationTime += elapsedTime;
    if (animationTime > 1) {
      animationTime -= 1;
    }
    update();
    lastTime = currentTime;
  }
};

function toggleLoop(value) {
  running = value;
  if (running) {
    lastTime = Date.now();
    loop();
  } else {
    cancelAnimationFrame(requestId);
  }
};

// EVENT HANDLERS

onload = async (e) => {
  // the real "main" of the game
  document.title = 'SUBmersible WARship 2063';

  onresize();
  // load charset so we can write 'loading...' on screen
  charset = await loadImg(charset);

  toggleLoop(true);

  // TODO put this is a web worker so the loading animation loop can work
  setTimeout(function() {
    initTileset(),
    initLevels();
    initSound(),
    // TODO potential DOMException because player hasn't clicked on anything yet
    // should ask to press any key when loading is done, then play track
    musicAudio.play();
    screen = TITLE_SCREEN;
  }, 100);
};

onresize = () => {
  // fit canvas in screen while maintaining aspect ratio
  c.width = BUFFER.width = innerWidth > innerHeight * RATIO ? innerHeight * RATIO : innerWidth;
  c.height = BUFFER.height = innerWidth > innerHeight * RATIO ? innerHeight : innerWidth / RATIO;

  // disable smoothing on image scaling
  CTX.imageSmoothingEnabled = BUFFER_CTX.imageSmoothingEnabled = false;
};

// UTILS

document.onvisibilitychange = (e) => {
  // pause loop and game timer when switching tabs
  toggleLoop(!e.target.hidden);
};

function loadImg(dataUri) {
  return new Promise((resolve) => {
    let img = new Image();
    img.onload = () => resolve(img);
    img.src = dataUri;
  });
};

// INPUT HANDLERS

onkeydown = (e) => {
  // prevent itch.io from scrolling the page up/down
  e.preventDefault();

  if (!e.repeat) {
    switch (screen) {
      case GAME_SCREEN:
        switch (e.code) {
          case 'ArrowLeft':
          case 'KeyA':
            hero.input.left = -1;
            break;
          case 'ArrowUp':
          case 'KeyW':
            hero.input.up = -1;
            break;
          case 'ArrowRight':
          case 'KeyD':
            hero.input.right = 1;
            break;
          case 'ArrowDown':
          case 'KeyS':
            hero.input.down = 1;
            break;
          case 'Space':
            if (!hero.dead) {
              fireTorpedo(hero, hero.collision.group);
            }
            break;
          case 'KeyP':
            // Pause game as soon as key is pressed
            toggleLoop(!running);
            break;
        }
        break;
    }
  }
};

onkeyup = (e) => {
  switch (screen) {
    case TITLE_SCREEN:
      if (e.which !== konamiCode[konamiIndex] || konamiIndex === konamiCode.length) {
        screen = LEVEL_SCREEN;
      } else {
        konamiIndex++;
        if (konamiIndex === konamiCode.length) {
          // secret code complete
          konamiAudio.play();
        }
      }
      break;
    case LEVEL_SCREEN:
      startGame();
      break;
    case GAME_SCREEN:
      switch (e.code) {
        case 'ArrowLeft':
        case 'KeyA':
          hero.input.left = 0;
          break;
        case 'ArrowRight':
        case 'KeyD':
          hero.input.right = 0;
          break;
        case 'ArrowUp':
        case 'KeyW':
          hero.input.up = 0;
          break;
        case 'ArrowDown':
        case 'KeyS':
          hero.input.down = 0;
          break;
        case 'KeyO': // when playing with arrows
        case 'KeyF': // when playing with WASD
          hero.online = !hero.online;
          hero.switchModeTime = currentTime;
          break;
      }
      break;
    case END_SCREEN:
      switch (e.code) {
        case 'KeyT':
          open(`https://twitter.com/intent/tweet?text=I%20sunk%20${nbSubSunk||0}%20enemy%20submarines%20in%20SUBmersible%20WARship%202063%20by%20@herebefrogs%20for%20@js13kgames%202018%3A%20https%3A%2F%2Fgoo.gl%2FHLo6Df`, '_blank');
          break;
        default:
          restartGame();
          break;
      }
      break;
  }
};

// MOBILE INPUT HANDLERS

// let minX = 0;
// let minY = 0;
// let maxX = 0;
// let maxY = 0;
// let MIN_DISTANCE = 44; // in px
// let touches = [];

// // adding onmousedown/move/up triggers a MouseEvent and a PointerEvent
// // on platform that support both (duplicate event, pointer > mouse || touch)
// ontouchstart = onpointerdown = (e) => {
//   e.preventDefault();
//   switch (screen) {
//     case GAME_SCREEN:
//       [maxX, maxY] = [minX, minY] = pointerLocation(e);
//       break;
//   }
// };

// ontouchmove = onpointermove = (e) => {
//   e.preventDefault();
//   switch (screen) {
//     case GAME_SCREEN:
//       if (minX && minY) {
//         setTouchPosition(pointerLocation(e));
//       }
//       break;
//   }
// }

// ontouchend = onpointerup = (e) => {
//   e.preventDefault();
//   switch (screen) {
//     case TITLE_SCREEN:
//       screen = LEVEL_SCREEN;
//       break;
//     case LEVEL_SCREEN:
//       startGame();
//       break;
//     case GAME_SCREEN:
//       // stop hero
//       hero.input.left = hero.input.right = hero.input.up = hero.input.down = 0;
//       // end touch
//       minX = minY = maxX = maxY = 0;
//       break;
//     case END_SCREEN:
//       restartGame();
//       break;
//   }
// };

// // utilities
// function pointerLocation(e) {
//   return [e.pageX || e.changedTouches[0].pageX, e.pageY || e.changedTouches[0].pageY];
// };

// function setTouchPosition([x, y]) {
//   // touch moving further right
//   if (x > maxX) {
//     maxX = x;
//     if (maxX - minX > MIN_DISTANCE) {
//       hero.input.right = 1;
//     }
//   }
//   // touch moving further left
//   else if (x < minX) {
//     minX = x;
//     if (maxX - minX > MIN_DISTANCE) {
//       hero.input.left = -1;
//     }
//   }
//   // touch reversing left while hero moving right
//   else if (x < maxX && hero.input.right) {
//     minX = x;
//     hero.input.right = 0;
//   }
//   // touch reversing right while hero moving left
//   else if (minX < x && hero.input.left) {
//     maxX = x;
//     hero.input.left = 0;
//   }

//   // touch moving further down
//   if (y > maxY) {
//     maxY = y;
//     if (maxY - minY > MIN_DISTANCE) {
//       hero.input.down = 1;
//     }
//   }
//   // touch moving further up
//   else if (y < minY) {
//     minY = y;
//     if (maxY - minY > MIN_DISTANCE) {
//       hero.input.up = -1;
//     }
//   }
//   // touch reversing up while hero moving down
//   else if (y < maxY && hero.input.down) {
//     minY = y;
//     hero.input.down = 0;
//   }
//   // touch reversing down while hero moving up
//   else if (minY < y && hero.input.up) {
//     maxY = y;
//     hero.input.up = 0;
//   }

//   // uncomment to debug mobile input handlers
//   // addDebugTouch(x, y);
// };

// function addDebugTouch(x, y) {
//   touches.push([x / innerWidth * BUFFER.width, y / innerHeight * BUFFER.height]);
//   if (touches.length > 10) {
//     touches = touches.slice(touches.length - 10);
//   }
// };

// function renderDebugTouch() {
//   let x = maxX / innerWidth * BUFFER.width;
//   let y = maxY / innerHeight * BUFFER.height;
//   renderDebugTouchBound(x, x, 0, BUFFER.height, '#f00');
//   renderDebugTouchBound(0, BUFFER.width, y, y, '#f00');
//   x = minX / innerWidth * BUFFER.width;
//   y = minY / innerHeight * BUFFER.height;
//   renderDebugTouchBound(x, x, 0, BUFFER.height, '#ff0');
//   renderDebugTouchBound(0, BUFFER.width, y, y, '#ff0');

//   if (touches.length) {
//     BUFFER_CTX.strokeStyle = BUFFER_CTX.fillStyle =   '#02d';
//     BUFFER_CTX.beginPath();
//     [x, y] = touches[0];
//     BUFFER_CTX.moveTo(x, y);
//     touches.forEach(function([x, y]) {
//       BUFFER_CTX.lineTo(x, y);
//     });
//     BUFFER_CTX.stroke();
//     BUFFER_CTX.closePath();
//     BUFFER_CTX.beginPath();
//     [x, y] = touches[touches.length - 1];
//     BUFFER_CTX.arc(x, y, 2, 0, 2 * Math.PI)
//     BUFFER_CTX.fill();
//     BUFFER_CTX.closePath();
//   }
// };

// function renderDebugTouchBound(_minX, _maxX, _minY, _maxY, color) {
//   BUFFER_CTX.strokeStyle = color;
//   BUFFER_CTX.beginPath();
//   BUFFER_CTX.moveTo(_minX, _minY);
//   BUFFER_CTX.lineTo(_maxX, _maxY);
//   BUFFER_CTX.stroke();
//   BUFFER_CTX.closePath();
// };
