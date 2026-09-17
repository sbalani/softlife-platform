export type ProductionRecipeAssignment = { recipe_id: string; order_ids: string[] };

const UUID = /^[0-9a-f-]{36}$/i;

export function parseProductionRecipeAssignments(fd: FormData) {
  const exportId = String(fd.get("export_id") ?? "");
  const assignmentIndexes = [...new Set(fd.getAll("assignment_index").map(String))];
  const requestedIndex = String(fd.get("apply_group") ?? "");
  const selectedIndexes = requestedIndex
    ? [requestedIndex]
    : assignmentIndexes.filter((index) => String(fd.get(`recipe_id_${index}`) ?? ""));
  const assignments: ProductionRecipeAssignment[] = assignmentIndexes.length
    ? selectedIndexes.map((index) => ({
      recipe_id: String(fd.get(`recipe_id_${index}`) ?? ""),
      order_ids: [...new Set(fd.getAll(`order_id_${index}`).map(String))],
    }))
    : [{
      recipe_id: String(fd.get("recipe_id") ?? ""),
      order_ids: [...new Set(fd.getAll("order_id").map(String))],
    }];
  const totalOrders = assignments.reduce((total, assignment) => total + assignment.order_ids.length, 0);
  const invalidAssignments = assignments.some((assignment) => !UUID.test(assignment.recipe_id)
    || !assignment.order_ids.length || assignment.order_ids.length > 200
    || assignment.order_ids.some((id) => !UUID.test(id)));
  if (!UUID.test(exportId) || !assignments.length || assignments.length > 100 || totalOrders > 2000 || invalidAssignments) {
    throw new Error(requestedIndex ? "Choose a complete recipe before applying this group." : "Choose at least one complete recipe to apply.");
  }
  return { exportId, assignments, totalOrders };
}
