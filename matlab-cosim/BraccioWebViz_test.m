%% BraccioWebViz_test - Verbindung zu BraccioSim ohne Simulink pruefen
%
%   1) Dieses Skript starten.
%   2) BraccioSim im Browser oeffnen (https://papillon220.github.io/BraccioRobotSim/),
%      Reiter "Co-Simulation" -> "Verbinden".
%   Der Roboter bewegt sich 60 s lang auf der Plattform, ein Wuerfel dreht
%   sich, und die Wand wird rot, solange die Basis weit ausgelenkt ist.
%   Angaben wie an den Unreal-Akteuren (Unreal-KS, y gespiegelt).
%
%   F. Bender, DHBW Stuttgart

if ~BraccioWebHub.selfTest
    error('BraccioWebViz: Selbsttest des WebSocket-Handshakes fehlgeschlagen.');
end

hub = BraccioWebHub.instance(true);
hub.start(8766);
cleanupHub = onCleanup(@() hub.stop());          % Port auch bei Strg+C freigeben

% Akteure: Name, Form, Groesse [m], Farbe, Transparenz, Lage (Unreal-KS)
actors = {
    'platform', 'box', [0.6 0.3 0.02],     [0.4 0.4 0.4], 0,   [0.1 0 -0.01]
    'cube1',    'box', [0.025 0.025 0.025], [0 0 1],      0,   [0.25 0 0.0175]
    'regal',    'box', [0.04 0.06 0.1],    [0.3 0.3 0.3], 0,   [0.4 0 0.05]
    'efence1',  'box', [0.002 0.3 0.3],    [0.4 0.4 0.4], 0.4, [-0.2 0 0.15]};
for i = 1:size(actors, 1)
    [p, r] = BraccioWebHub.fromUnreal(actors{i, 6}, [0 0 0]);
    hub.register(struct('n', actors{i, 1}, 'shape', actors{i, 2}, 'size', actors{i, 3}, ...
        'color', actors{i, 4}, 'alpha', actors{i, 5}, 'p', p, 'r', r, 's', [1 1 1]));
end

dt = 0.02;
tStart = tic;
for k = 0:round(60/dt)
    t = k*dt;
    if t > toc(tStart)
        pause(t - toc(tStart));                           % Schleife auf Echtzeit bremsen
    end
    q = [0.9*sin(0.4*t), pi/2 + 0.35*sin(0.6*t), -0.5 + 0.4*sin(0.5*t), ...
         pi/2 + 0.5*sin(0.8*t), 0.8*sin(0.3*t)];          % [rad], Grundstellung [0 pi/2 0 pi/2 0]
    hub.setRobot(q, (40 + 30*sin(1.2*t))*pi/180);         % Greifer 10..70 deg
    [p, r] = BraccioWebHub.fromUnreal([0.25 0 0.0175], [0 0 0.5*t]);
    hub.update('cube1', p, r, [], []);
    if abs(q(1)) > 0.8, c = [1 0 0]; else, c = [0.4 0.4 0.4]; end
    hub.update('efence1', [], [], c, []);
    hub.tick(t);
end
clear cleanupHub
