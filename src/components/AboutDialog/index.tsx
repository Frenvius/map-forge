import React from 'react';
import { Bug, Github } from 'lucide-react';
import { getVersion } from '@tauri-apps/api/app';

import { openUrl } from '~/adapter/assets';
import { Button } from '~/components/commons/ui/button';
import { Dialog, DialogTitle, DialogHeader, DialogContent, DialogDescription } from '~/components/commons/ui/dialog';

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const AUTHOR_URL = 'https://github.com/Frenvius';
const REPO_URL = `${AUTHOR_URL}/nosbor-map-editor`;
const ISSUES_URL = `${REPO_URL}/issues`;

const AboutDialog = ({ open, onOpenChange }: AboutDialogProps) => {
  const [version, setVersion] = React.useState('');

  React.useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[440px] gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>About Nosbor Map Editor</DialogTitle>
          <DialogDescription>Application information and resources</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center border-b border-border/50 px-6 pb-5 pt-8">
          <img src="/logo.png" draggable={false} alt="Nosbor Map Editor" className="mb-3 h-20 w-20 select-none" />
          <h2 className="text-2xl font-semibold tracking-tight">Nosbor Map Editor</h2>
          {version && <span className="mt-1 font-mono text-sm text-primary">{version}</span>}
        </div>

        <div className="space-y-3 px-6 py-4 text-xs leading-relaxed text-muted-foreground">
          <p className="text-foreground">
            Copyright &copy; {new Date().getFullYear()}{' '}
            <button
              type="button"
              onClick={() => void openUrl(AUTHOR_URL)}
              className="text-primary underline-offset-2 hover:underline"
            >
              Frenvius
            </button>
          </p>
          <p className="text-[10px] uppercase tracking-wide">
            THE SOFTWARE IS PROVIDED &ldquo;AS IS&rdquo;, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
            LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
            THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
            CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
            THE SOFTWARE.
          </p>
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-muted/30 px-6 py-3">
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => void openUrl(REPO_URL)}>
            <Github className="h-3.5 w-3.5" />
            GitHub
          </Button>
          <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-xs" onClick={() => void openUrl(ISSUES_URL)}>
            <Bug className="h-3.5 w-3.5" />
            Report Issue
          </Button>
          <Button size="sm" variant="outline" className="ml-auto h-8 text-xs" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AboutDialog;
