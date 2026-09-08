import type { Transport } from './model';
export const DEMO_ORIGIN = 'https://northstar.example';
export const demoTransport: Transport = async (url) => {
  const path = new URL(url).pathname;
  const content: Record<string, string> = {
    '/': '<!doctype html><html><head><title>Northstar Studio</title></head><body><h1>Good work starts here.</h1><img src="/hero.jpg"><img src="http://assets.example/banner.jpg" alt=""><a href="/about">About</a><a href="/services">Services</a><a href="/contact">Contact</a><a href="/old-offer">Offer</a></body></html>',
    '/about':
      '<html lang="en"><head><meta name="description" content="Meet our studio"></head><body><h1>About us</h1><img src="/team.jpg"></body></html>',
    '/services':
      '<html lang="en"><head><title>Services</title></head><body><h2>What we do</h2><img src="/services.jpg"></body></html>',
    '/contact':
      '<html lang="en"><head><title>Contact</title><meta name="description" content="Contact the studio"></head><body><h1>Let’s talk</h1></body></html>',
  };
  return {
    url,
    status: content[path] ? 200 : 404,
    html: content[path] || 'Not found',
    contentType: 'text/html',
    durationMs: 24,
  };
};
