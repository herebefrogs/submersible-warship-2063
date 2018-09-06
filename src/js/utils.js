export function clamp(value, min, max) {
  return value > max ? max : value < min ? min : value;
}

export function rand(min, max) {
  return Math.floor(Math.random() * (max + 1 - min) + min);
}

export function choice(values) {
  return values[rand(0, values.length - 1)];
}
