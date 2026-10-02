import { BedDouble, House, Tent, Users } from "lucide-react";
import { LODGING_KIND_LABEL, STAY_KINDS } from "@rv-trip/core";

/**
 * The stay-kind switch's options (Campground · Hotel · Airbnb · Friends), with
 * their icons — shared by DestinationDetailSheet's Stay form and the Add stay sheet's
 * "change" chip (#144). Lifted out of DestinationDetailSheet because that module
 * already imports AddStaySheet, so AddStaySheet can't import it back.
 */
const KIND_ICON = { campground: Tent, hotel: BedDouble, airbnb: House, friends: Users } as const;

export const KIND_OPTIONS = STAY_KINDS.map((k) => ({ value: k, label: LODGING_KIND_LABEL[k], Icon: KIND_ICON[k] }));
