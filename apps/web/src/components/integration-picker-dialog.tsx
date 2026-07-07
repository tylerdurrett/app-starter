import {
  Button,
  Dialog,
  DialogBackdrop,
  DialogPopup,
  DialogPortal,
  DialogTitle,
  Card,
  CardContent,
} from '@repo/ui';
import { getAllIntegrationTypes } from '../integrations/registry';

interface IntegrationPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (type: string) => void;
}

export function IntegrationPickerDialog({
  open,
  onOpenChange,
  onSelect,
}: IntegrationPickerDialogProps) {
  const integrationTypes = getAllIntegrationTypes();

  const handleSelect = (type: string) => {
    onSelect(type);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="max-w-2xl">
          <div className="space-y-4">
            <DialogTitle>Choose Integration Type</DialogTitle>
            <p className="text-sm text-muted-foreground">
              Select the service you want to integrate with your workspace
            </p>

            <div className="grid gap-3">
              {integrationTypes.map((entry) => (
                <Card
                  key={entry.metadata.type}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => handleSelect(entry.metadata.type)}
                >
                  <CardContent className="flex items-center gap-4 p-4">
                    <div className="text-3xl">{entry.metadata.icon}</div>
                    <div className="flex-1">
                      <h3 className="font-semibold">{entry.metadata.displayName}</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        {entry.metadata.description}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  );
}