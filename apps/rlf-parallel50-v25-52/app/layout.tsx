import type {Metadata} from 'next';

export const metadata: Metadata = {
  title: 'RLF PARALLEL50 v25.52',
  description: 'Durable EU-27 PRELOVED supplier research',
};

export default function Layout({children}: {children: React.ReactNode}) {
  return (
    <html lang="ca">
      <body style={{margin:0,background:'#080a0d',color:'#f4f6f8',fontFamily:'system-ui'}}>
        {children}
      </body>
    </html>
  );
}
