import { EmptyShelf } from "@rv-trip/ui";
import { BookmarkCheck, MapPinned } from "lucide-react";

export const WantQueueEmpty = () => (
  <div style={{ maxWidth: 560 }}>
    <EmptyShelf
      Icon={BookmarkCheck}
      title="Nothing in the queue yet"
      blurb="Heard about a great campground or diner? Save it here and add it to a trip when you're ready."
    />
  </div>
);

export const BeenArchiveEmpty = () => (
  <div style={{ maxWidth: 560 }}>
    <EmptyShelf
      Icon={MapPinned}
      title="No visited places yet"
      blurb="Places you rate on a trip show up here so you can decide what's worth a return."
    />
  </div>
);
