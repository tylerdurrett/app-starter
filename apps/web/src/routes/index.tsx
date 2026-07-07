import { createFileRoute, Link } from '@tanstack/react-router';
import { Button } from '@repo/ui';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold">Welcome to App Starter</h1>
        <p className="text-xl text-muted-foreground">Your app starter template</p>
        <div className="flex gap-4 justify-center pt-4">
          <Link to="/login">
            <Button variant="default">Sign In</Button>
          </Link>
          <Link to="/register">
            <Button variant="outline">Register</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
