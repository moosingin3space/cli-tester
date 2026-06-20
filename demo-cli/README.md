# Todo CLI

A simple zero-dependency interactive command-line to-do list, written in Node.js.

## Requirements

- Node.js (any recent version)

## Run

From this folder:

```sh
node todo.js
```

## Commands

At the `>` prompt:

| Command | Action |
| ------- | ------ |
| `l` / `list` | List all todos |
| `a` / `add` | Add a new todo |
| `c` / `check` | Toggle a todo as done / not done |
| `r` / `rename` | Rename a todo |
| `d` / `delete` | Delete a todo |
| `h` / `help` | Show the command menu |
| `q` / `quit` | Exit |

## Storage

Todos persist to `todos.json` in this folder. Delete that file to reset.
