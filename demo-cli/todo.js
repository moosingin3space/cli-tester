#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

let todos = load();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const ask = (q) => new Promise((res) => rl.question(q, res));

function list() {
  if (todos.length === 0) {
    console.log('\n(no todos yet)\n');
    return;
  }
  console.log();
  todos.forEach((t, i) => {
    const mark = t.done ? '[x]' : '[ ]';
    console.log(`  ${i + 1}. ${mark} ${t.text}`);
  });
  console.log();
}

function parseIndex(input) {
  const n = parseInt(input, 10);
  if (isNaN(n) || n < 1 || n > todos.length) {
    console.log('Invalid number.');
    return -1;
  }
  return n - 1;
}

async function add() {
  const text = (await ask('New todo: ')).trim();
  if (!text) return;
  todos.push({ text, done: false });
  save(todos);
}

async function check() {
  list();
  if (todos.length === 0) return;
  const i = parseIndex(await ask('Toggle which #? '));
  if (i < 0) return;
  todos[i].done = !todos[i].done;
  save(todos);
}

async function remove() {
  list();
  if (todos.length === 0) return;
  const i = parseIndex(await ask('Delete which #? '));
  if (i < 0) return;
  todos.splice(i, 1);
  save(todos);
}

async function rename() {
  list();
  if (todos.length === 0) return;
  const i = parseIndex(await ask('Rename which #? '));
  if (i < 0) return;
  const text = (await ask('New text: ')).trim();
  if (!text) return;
  todos[i].text = text;
  save(todos);
}

function menu() {
  console.log('Commands: (l)ist  (a)dd  (c)heck/toggle  (r)ename  (d)elete  (q)uit');
}

async function main() {
  console.log('\n=== Todo CLI ===');
  menu();
  list();
  while (true) {
    const cmd = (await ask('> ')).trim().toLowerCase();
    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') break;
    else if (cmd === 'l' || cmd === 'list') list();
    else if (cmd === 'a' || cmd === 'add') await add();
    else if (cmd === 'c' || cmd === 'check' || cmd === 'toggle') await check();
    else if (cmd === 'r' || cmd === 'rename') await rename();
    else if (cmd === 'd' || cmd === 'delete') await remove();
    else if (cmd === 'h' || cmd === 'help') menu();
    else if (cmd === '') continue;
    else console.log("Unknown command. Type 'h' for help.");
  }
  rl.close();
  console.log('Bye!');
}

main();
