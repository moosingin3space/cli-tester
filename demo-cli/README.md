# Todo CLI

A simple zero-dependency command-line to-do list, written in Node.js.

## Requirements

- Node.js (any recent version)

## Usage

From this folder:

```sh
node todo.js <command> [args]
```

### Commands

| Command | Description |
| ------- | ----------- |
| `list` | List all todos |
| `add <text...>` | Add a new todo |
| `check <number>` | Toggle a todo as done / not done |
| `rename <number> <text...>` | Rename a todo |
| `delete <number>` | Delete a todo |
| `help` | Show usage |

### Examples

```sh
node todo.js add buy milk
node todo.js add "write report"
node todo.js list
node todo.js check 1
node todo.js rename 2 "write final report"
node todo.js delete 1
```

## Storage

Todos persist to `todos.json` in this folder. Delete that file to reset.
