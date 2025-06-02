import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Code } from "lucide-react";
import type { FC, PropsWithChildren, ReactNode } from "react";

export const AppBlock: FC<
  PropsWithChildren<{
    title?: ReactNode;
    description?: ReactNode;
    codeUrl?: string;
  }>
> = ({ title, description, codeUrl, children }) => (
  <Card className="w-full">
    {!!(title || description) && (
      <CardHeader>
        {!!title && <CardTitle>{title}</CardTitle>}
        {!!description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
    )}
    <CardContent>{children}</CardContent>
    {!!codeUrl && (
      <CardFooter className="justify-end">
        <Button asChild variant="secondary">
          <a href={codeUrl} target="_blank" rel="noreferrer">
            <Code />
          </a>
        </Button>
      </CardFooter>
    )}
  </Card>
);
