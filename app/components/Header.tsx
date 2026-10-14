'use client';
import Icon from './Icon';
import {useCompare} from './CompareProvider';
export default function Header(){const {selected}=useCompare();return <header className="site-header"><div className="container header-inner"><a className="brand" href="/" aria-label="Rate My Highschool home"><Icon name="cap" size={42}/><span>Rate My Highschool</span></a><nav aria-label="Main navigation"><a href="/#schools">Find schools</a><a href="/compare">Compare{selected.length?` (${selected.length})`:''}</a><a href="/how-it-works">How ratings work</a><a className="mobile-account" href="/my-reviews">My reviews</a></nav><div className="header-actions"><a className="button secondary" href="/my-reviews">My reviews</a><a className="button" href="/?rate=1#schools">Rate a school</a></div></div></header>;}
