import { clamp, rand, choice } from './utils';

const konamiCode = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
let konamiIndex = 0;

// GAMEPLAY VARIABLES

const TITLE_SCREEN = 0;
const GAME_SCREEN = 1;
const END_SCREEN = 2;
let screen = TITLE_SCREEN;

let hero;
let entities;
let raised = [];
let looseCondition;
let winCondition;
let endTime;
let nbSubSunk = 0;

const RADIAN = 180 / Math.PI;

// COMPONENTS

function Input() {
  this.left = 0;
  this.right = 0;
  this.up = 0;
  this.down = 0;
}

function Strategy(type, target) {
  this.type = type;
  this.target = target;
  // TODO remove when 'random' isn't a thing anymore
  this.nextChange = 0.5;
  this.remaining = 0;
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

function Collision(collide, killable, foe) {
  this.collide = collide;
  this.killable = killable;
  this.foe = foe; // boolean indicating if the entity is a friend or a foe, so torpedoes can lock on the right kind of entity
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

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789.:!-%,/';
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

// LOOP VARIABLES

let currentTime;
let elapsedTime;
let lastTime;
let requestId;
let running = true;

// GAMEPLAY HANDLERS

function startGame() {
  endTime = 0;
  hero = createEntity('player', {
    collision: new Collision(true, konamiIndex !== konamiCode.length, false),
    input: new Input(),
    position: new Position(200, BUFFER.height - 200),
    velocity: new Velocity(40),
    sprite: new Sprite(true, renderPlayerSub, renderPlayerRadar, () => renderDebris('rgb(75,190,250)')),
  });
  looseCondition = [hero];
  winCondition = [
    createEntity('sub1', {
      collision: new Collision(true, true, true),
      input: new Input(),
      position: new Position(100, 100),
      velocity: new Velocity(20),
      strategy: new Strategy('random'),
      sprite: new Sprite(false, renderEnemySub, renderEnemyRadar, () => renderDebris('rgb(230,90,100)')),
    }),
    createEntity('sub1', {
      collision: new Collision(true, true, true),
      input: new Input(),
      position: new Position(100, BUFFER.height - 100),
      velocity: new Velocity(20),
      strategy: new Strategy('random'),
      sprite: new Sprite(false, renderEnemySub, renderEnemyRadar, () => renderDebris('rgb(230,90,100)')),
    }),
    createEntity('sub1', {
      collision: new Collision(true, true, true),
      input: new Input(),
      position: new Position(BUFFER.width - 100, 100),
      velocity: new Velocity(20),
      strategy: new Strategy('random'),
      sprite: new Sprite(false, renderEnemySub, renderEnemyRadar, () => renderDebris('rgb(230,90,100)')),
    }),
    createEntity('sub1', {
      collision: new Collision(true, true, true),
      input: new Input(),
      position: new Position(BUFFER.width - 100, BUFFER.height - 100),
      velocity: new Velocity(20),
      strategy: new Strategy('random'),
      sprite: new Sprite(false, renderEnemySub, renderEnemyRadar, () => renderDebris('rgb(230,90,100)')),
    }),
  ];
  entities = [
    // createEntity('rock', {
      //   collision: new Collision(true, false),
      //   position: new Position(BUFFER.width - 200, 200),
      //   velocity: new Velocity(0),
    //   sprite: new Sprite(true, renderRock),
    // }),
    ...looseCondition,
    ...winCondition,
  ];
  screen = GAME_SCREEN;
};

function createEntity(type, components) {
  return {
    ...components,
    echo: { ...components.position },
    online: true,
    radius: 6,
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

function inRange({ x: x1, y: y1 }, { x: x2, y: y2 }, distance) {
  return Math.pow(distance, 2) > Math.pow(x1 - x2, 2) + Math.pow(y1 - y2, 2)
};

function testCircleCollision(entity1, entity2) {
  const { position: position1, collision: collision1 } = entity1;
  const { position: position2, collision: collision2 } = entity2;
  return (
    collision1.collide
    && collision2.collide
    && inRange(position1, position2, entity1.radius + entity2.radius)
  );
};

function constrainToViewport(entity) {
  const { position } = entity;
  position.x = clamp(position.x, 0, BUFFER.width - entity.radius)
  position.y = clamp(position.y, 0, BUFFER.height - entity.radius)
};

function fireTorpedo({ position: subPos }, target) {
  const strategy = new Strategy(target ? 'lockon' : 'cruise');
  const input = target ? new Input() : null;
  const collision = new Collision(true, true, !!target);
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
  raised.push(createEntity('torpedo', { collision, input, position, sprite, strategy, ttl, velocity }));
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

function updateStrategy(entity) {
  const { strategy, position, collision: { foe } } = entity;
  if (strategy) {
    switch (strategy.type) {
      case 'lockon':
        const { echo, online, dead } = strategy.target;
        // if target has been already destroyed, or has gone offline and torpedo within 10px of last known position
        // TODO 10px should be in a constant of some kind
        if (dead || (!online && inRange(position, echo, 10))) {
          // switch back to moving in a straight line
          entity.strategy = {
            ...strategy,
            type: 'cruise',
            target: undefined,
            nextChange: 0.5,
            remaining: 0,
          };
          entity.input = null;
          entity.velocity.dr = 0;
        }
        break;
      case 'cruise':
        // torpedoes can only lock on enemy entities
        entities.filter(({ collision }) => !!collision.foe && collision.foe !== foe).forEach(function(enemy) {
          const { echo } = enemy;
          // TODO 180 works for torpedos right now, but might need to change when applied to enemy sub range
          if (inRange(position, echo, 180) && Math.abs(angleDifference(entity, enemy)) < 22.5) { // 22.5deg = Math.PI/8
            entity.strategy = {
              ...strategy,
              type: 'lockon',
              target: enemy,
              nextChange: 0.1,
              remaining: 0,
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

// between 2 vectors, in degree and in range [-180, 180]
function angleDifference2DVectors({ x: x1, y: y1 }, { x: x2, y: y2}) {
  return (((Math.atan2(y2, x2) - Math.atan2(y1, x1)) * RADIAN + 180) % 360) - 180;
};

function applyStrategyToInput(entity) {
  const { input, strategy } = entity
  if (strategy) {
    strategy.remaining -= elapsedTime;
    if (strategy.remaining < 0) {
      strategy.remaining += strategy.nextChange;
      switch (strategy.type) {
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
  if (sprite.alwaysRender || hero.online && online) {
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
  if (looseCondition.length === looseCondition.filter(({ dead }) => dead).length
    || winCondition.length === winCondition.filter(({ dead }) => dead).length) {
      endTime += elapsedTime;
  }
  if (endTime > 4) {
    screen = END_SCREEN;
  }
};

function update() {
  switch (screen) {
    case GAME_SCREEN:
      entities.forEach((entity) => {
        updateStrategy(entity);
        applyStrategyToInput(entity);
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
    case TITLE_SCREEN:
      renderGrid();
      renderTitle();
      renderText('press any key', BUFFER.width / 2, BUFFER.height / 2, ALIGN_CENTER);
      // TODO remove and play konami code sound instead
      if (konamiIndex === konamiCode.length) {
        renderText('konami mode on', BUFFER.width - CHARSET_SIZE, CHARSET_SIZE, ALIGN_RIGHT);
      }
      break;
    case GAME_SCREEN:
      // uncomment to debug mobile input handlers
      // renderDebugTouch();
      renderGrid();
      entities.forEach(renderRadar);
      entities.forEach(renderEntity);
      renderText(`sonar: ${hero.online ? 'on' : 'off'}line`, CHARSET_SIZE, CHARSET_SIZE);
      break;
    case END_SCREEN:
      renderText('game over', CHARSET_SIZE, CHARSET_SIZE);
      renderText(`you ${winCondition.length === winCondition.filter(({ dead }) => dead).length ? 'won' : 'lost'}`, BUFFER.width / 2, BUFFER.height / 2, ALIGN_CENTER)
      break;
  }

  blit();
};

function initTileset() {
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
  BUFFER_CTX.translate(BUFFER.width / 2 - 100, 100);
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

function renderEntity({ echo, sprite }) {
  BUFFER_CTX.save();

  BUFFER_CTX.translate(Math.round(echo.x), Math.round(echo.y));
  BUFFER_CTX.rotate(echo.r / RADIAN);

  sprite.renderer();

  BUFFER_CTX.restore();
};

function renderPlayerSub() {
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.fillStyle = 'rgb(75,190,250)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.fillStyle;
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, 0, 5, 0, Math.PI*2);
  BUFFER_CTX.fillRect(-2, -12, 4, 12);
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
  BUFFER_CTX.fillRect(-5, -5, 10, 10);
  BUFFER_CTX.fillRect(-2, -12, 4, 12);
  BUFFER_CTX.fill();
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

function renderRadar(entity) {
  const { echo, sprite } = entity;
  if (sprite.radarRenderer) {
    BUFFER_CTX.save();
    BUFFER_CTX.translate(Math.round(echo.x), Math.round(echo.y));

    sprite.radarRenderer(entity);

    BUFFER_CTX.restore();
  }
};

function renderRock() {
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.strokeStyle = 'rgb(70,105,105)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle;
  BUFFER_CTX.fillStyle = 'rgba(30,60,60,0.5)';
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(-100, -50);
  BUFFER_CTX.lineTo(-50, -40);
  BUFFER_CTX.lineTo(20, -45);
  BUFFER_CTX.lineTo(30, -25);
  BUFFER_CTX.lineTo(20, 10);
  BUFFER_CTX.lineTo(-10, 25);
  BUFFER_CTX.lineTo(-85, -15);
  BUFFER_CTX.closePath();
  BUFFER_CTX.fill();
  BUFFER_CTX.stroke();
};

function renderTorpedoRadar({ echo }) {
  BUFFER_CTX.rotate(echo.r / RADIAN);
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

function renderEnemyRadar() {
  // radar
  BUFFER_CTX.shadowBlur = 10;
  BUFFER_CTX.strokeStyle = 'rgb(55,40,35)';
  BUFFER_CTX.shadowColor = BUFFER_CTX.strokeStyle;
  BUFFER_CTX.beginPath();
  BUFFER_CTX.arc(0, 0, 80, 0, Math.PI*2);
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
  document.title = 'Submersible Warship 2063';

  onresize();
  initTileset();

  charset = await loadImg(charset);
  toggleLoop(true);
};

onresize = onrotate = () => {
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
              fireTorpedo(hero);
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
        startGame();
      } else {
        konamiIndex++;
        // TODO play konami code sound if sequence complete
      }
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
          open(`https://twitter.com/intent/tweet?text=I%20sunk%20${nbSubSunk||0}%20enemy%20submarines%20in%20Submersible%20Warship%202063%20by%20@herebefrogs%20for%20@js13kgames%202018%3A%20https%3A%2F%2Fgoo.gl%2FHLo6Df`, '_blank');
          break;
        default:
          konamiIndex = 0;
          screen = TITLE_SCREEN;
          break;
      }
      break;
  }
};

// MOBILE INPUT HANDLERS

let minX = 0;
let minY = 0;
let maxX = 0;
let maxY = 0;
let MIN_DISTANCE = 44; // in px
let touches = [];

// adding onmousedown/move/up triggers a MouseEvent and a PointerEvent
// on platform that support both (duplicate event, pointer > mouse || touch)
ontouchstart = onpointerdown = (e) => {
  e.preventDefault();
  switch (screen) {
    case GAME_SCREEN:
      [maxX, maxY] = [minX, minY] = pointerLocation(e);
      break;
  }
};

ontouchmove = onpointermove = (e) => {
  e.preventDefault();
  switch (screen) {
    case GAME_SCREEN:
      if (minX && minY) {
        setTouchPosition(pointerLocation(e));
      }
      break;
  }
}

ontouchend = onpointerup = (e) => {
  e.preventDefault();
  switch (screen) {
    case TITLE_SCREEN:
      startGame();
      break;
    case GAME_SCREEN:
      // stop hero
      hero.input.left = hero.input.right = hero.input.up = hero.input.down = 0;
      // end touch
      minX = minY = maxX = maxY = 0;
      break;
    case END_SCREEN:
      konamiIndex = 0;
      screen = TITLE_SCREEN;
      break;
  }
};

// utilities
function pointerLocation(e) {
  return [e.pageX || e.changedTouches[0].pageX, e.pageY || e.changedTouches[0].pageY];
};

function setTouchPosition([x, y]) {
  // touch moving further right
  if (x > maxX) {
    maxX = x;
    if (maxX - minX > MIN_DISTANCE) {
      hero.input.right = 1;
    }
  }
  // touch moving further left
  else if (x < minX) {
    minX = x;
    if (maxX - minX > MIN_DISTANCE) {
      hero.input.left = -1;
    }
  }
  // touch reversing left while hero moving right
  else if (x < maxX && hero.input.right) {
    minX = x;
    hero.input.right = 0;
  }
  // touch reversing right while hero moving left
  else if (minX < x && hero.input.left) {
    maxX = x;
    hero.input.left = 0;
  }

  // touch moving further down
  if (y > maxY) {
    maxY = y;
    if (maxY - minY > MIN_DISTANCE) {
      hero.input.down = 1;
    }
  }
  // touch moving further up
  else if (y < minY) {
    minY = y;
    if (maxY - minY > MIN_DISTANCE) {
      hero.input.up = -1;
    }
  }
  // touch reversing up while hero moving down
  else if (y < maxY && hero.input.down) {
    minY = y;
    hero.input.down = 0;
  }
  // touch reversing down while hero moving up
  else if (minY < y && hero.input.up) {
    maxY = y;
    hero.input.up = 0;
  }

  // uncomment to debug mobile input handlers
  // addDebugTouch(x, y);
};

function addDebugTouch(x, y) {
  touches.push([x / innerWidth * BUFFER.width, y / innerHeight * BUFFER.height]);
  if (touches.length > 10) {
    touches = touches.slice(touches.length - 10);
  }
};

function renderDebugTouch() {
  let x = maxX / innerWidth * BUFFER.width;
  let y = maxY / innerHeight * BUFFER.height;
  renderDebugTouchBound(x, x, 0, BUFFER.height, '#f00');
  renderDebugTouchBound(0, BUFFER.width, y, y, '#f00');
  x = minX / innerWidth * BUFFER.width;
  y = minY / innerHeight * BUFFER.height;
  renderDebugTouchBound(x, x, 0, BUFFER.height, '#ff0');
  renderDebugTouchBound(0, BUFFER.width, y, y, '#ff0');

  if (touches.length) {
    BUFFER_CTX.strokeStyle = BUFFER_CTX.fillStyle =   '#02d';
    BUFFER_CTX.beginPath();
    [x, y] = touches[0];
    BUFFER_CTX.moveTo(x, y);
    touches.forEach(function([x, y]) {
      BUFFER_CTX.lineTo(x, y);
    });
    BUFFER_CTX.stroke();
    BUFFER_CTX.closePath();
    BUFFER_CTX.beginPath();
    [x, y] = touches[touches.length - 1];
    BUFFER_CTX.arc(x, y, 2, 0, 2 * Math.PI)
    BUFFER_CTX.fill();
    BUFFER_CTX.closePath();
  }
};

function renderDebugTouchBound(_minX, _maxX, _minY, _maxY, color) {
  BUFFER_CTX.strokeStyle = color;
  BUFFER_CTX.beginPath();
  BUFFER_CTX.moveTo(_minX, _minY);
  BUFFER_CTX.lineTo(_maxX, _maxY);
  BUFFER_CTX.stroke();
  BUFFER_CTX.closePath();
};
