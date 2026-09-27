import { GanttLegend } from "@rv-trip/ui";

/** Every key — what a caller that passes no `modes` renders. */
export const Default = () => <GanttLegend />;

/** The three seed cases (#112 · klunk row 3): the legend names only the modes
 * a trip's rhythm has. */
export const PacificNorthwestLoop = () => <GanttLegend modes={["drive"]} />;
export const CostaRicaFlyAndStay = () => <GanttLegend modes={["fly"]} />;
export const GreeceAthensAndTheCyclades = () => <GanttLegend modes={["fly", "ferry"]} />;
