# Cafe OS

A simple CLI for managing a cafe's inventory and orders.

## How to Run

First, install dependencies:
```bash
pnpm install
```

Then, set up the database:
```bash
pnpm db:migrate
pnpm data-migrate
```

Finally, start the application:
```bash
pnpm start
```

## How to Test

Here are a few simple tests to verify the core functionality.

### Test Inventory Deduction

Verifies that ordering deducts ingredients correctly.

1. Check initial stock:
   ```bash
   sqlite3 cafe.db "SELECT name, quantity FROM inventory_items WHERE name = 'Coffee Beans: Espresso Roast';"
   ```
   Should show: `1000000`

2. Order an Americano: Run `pnpm start` and order an Americano.

3. Verify deduction:
   ```bash
   sqlite3 cafe.db "SELECT name, quantity FROM inventory_items WHERE name = 'Coffee Beans: Espresso Roast';"
   ```
   Should show: `984000`

### Test Out-of-Stock Logic

Verifies the app prevents orders when ingredients are unavailable.

1. Set milk to zero:
   ```bash
   sqlite3 cafe.db "UPDATE inventory_items SET quantity = 0 WHERE name = 'Milk';"
   ```

2. Run the app: Use `pnpm start`

3. Observe: Items requiring milk show "0 orders possible". Ordering them will fail.

### Cleanup

Restock milk for future tests:
```bash
sqlite3 cafe.db "UPDATE inventory_items SET quantity = 10000 WHERE name = 'Milk';"
```