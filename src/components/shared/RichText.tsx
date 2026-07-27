import { markdownToBlocks } from '@/lib/rich-text';

/**
 * Toont tekst die markdown kán bevatten als leesbare opmaak in plaats van als ruwe tekens.
 *
 * AI-output komt vaak met `##`-koppen en `**vet**` terug. Zetten we dat in een <p>, dan leest
 * de gebruiker letterlijk "## Wat ga je doen" (meeting 27-07). Platte tekst zonder opmaak
 * gaat hier gewoon doorheen als alinea's, dus dit is veilig voor élke omschrijving.
 */
const RichText = ({ value, className = '' }: { value: string | null | undefined; className?: string }) => {
  const blocks = markdownToBlocks(value);
  if (blocks.length === 0) return null;

  return (
    <div className={`space-y-3 ${className}`}>
      {blocks.map((block, i) => {
        if (block.type === 'heading') {
          return <h4 key={i} className="text-sm font-semibold">{block.text}</h4>;
        }
        if (block.type === 'list') {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
              {block.items.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          );
        }
        return <p key={i} className="text-sm leading-relaxed">{block.text}</p>;
      })}
    </div>
  );
};

export default RichText;
