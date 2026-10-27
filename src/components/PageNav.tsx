"use client";

import Link from "next/link";
import { Logo } from "./Logo";

/** Navigation for pages other than the main workstation. */
export function PageNav() {
  return (
    <nav className="nav" aria-label="Main">
      <div className="nav-inner">
        <Link className="brand" href="/" aria-label="Tidate, home">
          <Logo />
        </Link>
        <span className="nav-spacer" />
        <Link className="nav-link" href="/tour">
          Plan a run
        </Link>
        <Link className="nav-link" href="/watch">
          Watching
        </Link>
        <Link className="nav-link wide-nav" href="/">
          New analysis
        </Link>
      </div>
    </nav>
  );
}
