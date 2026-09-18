# Recipe units, approval names and outlet refresh update

For an existing installation:

1. In Supabase SQL Editor run the complete `migrations/20260918_production_fixes.sql`. This patch is safe to rerun. It adds the missing approval-name function, a protected new-material action, receipt unit aliases and outlet stock Realtime publication. It does not change quantities or add an order deduction trigger.
2. Replace `production-dashboard.js` and `production-dashboard.css` beside your live `store.html`.
3. Hard-refresh the browser / reopen the PWA online.

Do not rerun the original `20260918_production_workspace.sql` on an installed database. If applying the separate collection-tracking migration, apply the production fixes patch AFTER it so the receipt unit update is retained. The collection tracking and display-stock policy scripts are separate changes; follow their installation instructions in the integration guide.

## Using the changes

- Approved recipe versions reload when the baking form opens. The latest version is selected and planned kg is calculated from its yield. With no matching recipe, a clear message offers to create one for that product.
- The recipe form has a quantity-unit selector on each line. For a material stocked in kg, entering **170 g** saves **0.17 kg** for deduction and displays **170 g** in the recipe. Volume and count conversions also support ml/litres and pieces/dozens.
- Use **Add new ingredient / packaging** inside the recipe form if the material is missing. This preserves the recipe draft and creates the material with zero stock. Record a receipt in Materials before baking; creation does not invent stock or cost.
- Existing recipes with incorrect quantities are not silently changed. Use **Recipes → Add recipe version** for the same product and enter the correct amounts and units. The latest version will be selected for new batches. For the screenshot's flour example, use `170` and `g`, not `170` and `kg`. Confirm the intended units for sugar, butter, cream and eggs individually. If any batch already consumed the incorrect quantities, its inventory correction must be reviewed separately.
- Approval names come from the approver's customer profile or Supabase Auth profile. If no name is recorded, a short user ID is shown; add the person's name to their profile rather than inventing one.
- Outlet stock reacts to order/stock events and checks the stock table once per minute while Dashboard/Outlet is visible. It does not continuously reload sales history. The timestamp shows when stock was last checked.

If outlet quantities remain unchanged even after Refresh and a real sale, the live database's existing sales deduction trigger needs inspection. Run `migrations/production_preflight.sql` and inspect the `store_orders` triggers. This update fixes refresh behavior; it deliberately does not create a second deduction trigger without knowing what already exists.
