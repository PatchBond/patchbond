import { Link } from "react-router";
import { Button, Mark } from "../components/kit";

export function NotFound() {
  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4 text-center">
      <div>
        <Mark size={56} className="mx-auto opacity-60" />
        <h1 className="mt-6 text-2xl font-semibold">Nothing here</h1>
        <p className="mt-2 text-muted-foreground">This page doesn't exist. If you followed a pay or verdict link, check it's complete.</p>
        <Link to="/" className="mt-6 inline-block">
          <Button variant="ghost">Back home</Button>
        </Link>
      </div>
    </div>
  );
}
