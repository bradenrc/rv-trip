import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

/**
 * #80 · gesture 1's Undo must DETACH before it deletes — asserted as source.
 *
 * The bug this pins is a data-loss one and it is invisible from either side on
 * its own. `ideas.stop_id` is ON DELETE CASCADE (packages/db/src/schema.ts:133),
 * so an Undo that deletes the stop the plan created while the idea is still
 * attached silently destroys the idea: the client puts the row back on the
 * shelf, the server has already removed it, and it is gone on the next load.
 * The DATABASE half of that is proved for real against Postgres in
 * `api/ideas/[id]/route.test.ts` ("the plan-undo order (#80)") — both arms,
 * cascade and survival. What that cannot prove is that the CLIENT sends them in
 * that order, and apps/web's vitest is `environment: "node"` with no DOM, no
 * jsdom and no @testing-library/react, so `doPlanIdea`'s toast action cannot be
 * clicked in a test.
 *
 * So the order is asserted here as source text, the same idiom
 * `navigate-control.test.ts` already uses for the render it cannot run. It is a
 * weaker test than an executed one and it is named as such — but it fails the
 * moment someone reverts the chain to a bare `deleteStop`, which is the
 * regression that matters.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(HERE, "TripPlanner.tsx"), "utf8");

/** The body of `doPlanIdea`, from its declaration to the next one. */
const doPlanIdea = source.slice(
  source.indexOf("const doPlanIdea ="),
  source.indexOf("const doAttachIdea ="),
);

describe("doPlanIdea's Undo, as source", () => {
  it("is a real slice of the file, not an empty string", () => {
    expect(doPlanIdea).toContain("tripApi.createStop(");
    expect(doPlanIdea.length).toBeGreaterThan(200);
  });

  it("detaches the idea before it deletes the stop", () => {
    const detach = doPlanIdea.indexOf("stopId: null");
    const del = doPlanIdea.indexOf("tripApi.deleteStop(created.id)");

    expect(detach).toBeGreaterThan(-1); // the undo detaches at all
    expect(del).toBeGreaterThan(-1); // …and still removes the stop it made
    expect(detach).toBeLessThan(del); // …in THAT order
  });

  it("chains them rather than firing both — a cascade is not racy by luck", () => {
    // `.then(` between the detach and the delete is what makes the DELETE wait
    // for the PATCH's 204 instead of overtaking it on the wire.
    const between = doPlanIdea.slice(
      doPlanIdea.indexOf("stopId: null"),
      doPlanIdea.indexOf("tripApi.deleteStop(created.id)"),
    );
    expect(between).toContain(".then(");
  });

  it("restores the status the plan moved off, not a hardcoded one", () => {
    // The plan sets "planned"; the undo must put back what the idea HAD.
    expect(doPlanIdea).toContain('{ stopId: created.id, status: "planned" }');
    expect(doPlanIdea).toContain("{ stopId: null, status: it.status }");
  });
});
