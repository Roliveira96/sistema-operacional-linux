import './estilos/base.css';
import './estilos/menu.css';
import './estilos/topico.css';
import './estilos/terminal.css';
import { Aplicacao } from './app/Aplicacao';

const raiz: HTMLElement = document.getElementById('app') as HTMLElement;
new Aplicacao(raiz).iniciar();
