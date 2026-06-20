#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'todos.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function save(todos) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(todos, null, 2));
}

function list(todos) {
  if (todos.length === 0) {
    console.log('(no todos yet)');
    return;
  }
  todos.forEach((t, i) => {
    const mark = t.done ? '[x]' : '[ ]';
    console.log(`${i + 1}. ${mark} ${t.text}`);
  });
}

function parseIndex(arg, todos) {
  const n = parseInt(arg, 10);
  if (isNaN(n) || n < 1 || n > todos.length) {
    console.error(`Invalid todo number: ${arg}`);
    process.exit(1);
  }
  return n - 1;
}

function usage() {
  console.log(`Usage:
  todo list
  todo add <text...>
  todo check <number>
  todo rename <number> <text...>
  todo delete <number>`);
}

const [cmd, ...args] = process.argv.slice(2);
const todos = load();

switch (cmd) {
  case 'list':
  case 'ls':
    list(todos);
    break;

  case 'add': {
    const text = args.join(' ').trim();
    if (!text) {
      console.error('Missing todo text.');
      process.exit(1);
    }
    todos.push({ text, done: false });
    save(todos);
    console.log(`Added: ${text}`);
    break;
  }

  case 'check':
  case 'toggle': {
    if (!args[0]) {
      console.error('Missing todo number.');
      process.exit(1);
    }
    const i = parseIndex(args[0], todos);
    todos[i].done = !todos[i].done;
    save(todos);
    console.log(`${todos[i].done ? 'Checked' : 'Unchecked'}: ${todos[i].text}`);
    break;
  }

  case 'rename': {
    const i = parseIndex(args[0], todos);
    const text = args.slice(1).join(' ').trim();
    if (!text) {
      console.error('Missing new text.');
      process.exit(1);
    }
    const old = todos[i].text;
    todos[i].text = text;
    save(todos);
    console.log(`Renamed: ${old} -> ${text}`);
    break;
  }

  case 'delete':
  case 'rm': {
    const i = parseIndex(args[0], todos);
    const [removed] = todos.splice(i, 1);
    save(todos);
    console.log(`Deleted: ${removed.text}`);
    break;
  }

  case undefined:
  case 'help':
  case '-h':
  case '--help':
    usage();
    break;

  default:
    console.error(`Unknown command: ${cmd}`);
    usage();
    process.exit(1);
}
