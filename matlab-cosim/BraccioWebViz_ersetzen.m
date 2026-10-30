function n = BraccioWebViz_ersetzen(mdl)
%BRACCIOWEBVIZ_ERSETZEN Ersetzt alle Unreal-Bloecke (Simulation 3D) durch Web-Bloecke fuer BraccioSim.
%
%   BraccioWebViz_ersetzen('Braccio_CtrlSimMdl')
%
%   Simulation 3D Scene Configuration -> Web Scene Configuration (BraccioWebScene)
%   Simulation 3D Robot               -> Web Robot  (BraccioWebRobot), Eingang Config
%   Simulation 3D Actor               -> Web Actor  (BraccioWebActor), gleiche Eingaenge
%
%   Uebernommen werden Name, Lage, Eingaenge und Verbindungen sowie Form,
%   Groesse, Farbe und Transparenz aus dem Init-Skript der Akteure. Die
%   Terminatoren an den Ausgaengen der Unreal-Akteure entfallen.
%   Das Modell wird nicht gespeichert - danach unter neuem Namen speichern.
%
%   F. Bender, DHBW Stuttgart

arguments
    mdl {mustBeTextScalar} = bdroot
end
mdl = char(mdl);
load_system(mdl);
blocks = find_system(mdl, 'LookUnderMasks', 'all', 'FollowLinks', 'off', 'RegExp', 'on', ...
    'ReferenceBlock', '^(sim3dlib|robotsim3dlib|sl3dlib)/');
n = 0;
for i = 1:numel(blocks)
    blk = blocks{i};
    ref = get_param(blk, 'ReferenceBlock');
    if contains(ref, 'Scene Configuration')
        cls = 'BraccioWebScene';
        prm = {'Port', '8766', 'SampleTime', '0.02'};
    elseif contains(ref, 'Robot')
        cls = 'BraccioWebRobot';
        prm = {'ActorName', get_param(blk, 'ActorName'), ...
            'GripperGain', 'braccioGripper.servoGain', 'GripperQ6', 'braccioGripper.q6_stl'};
    else
        cls = 'BraccioWebActor';
        prm = actorParams(blk);
    end
    replaceBlock(blk, cls, prm);
    n = n + 1;
end
fprintf('BraccioWebViz: %d Unreal-Bloecke ersetzt. Modell unter neuem Namen speichern.\n', n);
end

function prm = actorParams(blk)
% Parameter eines Simulation 3D Actor fuer den Web Actor
s = get_param(blk, 'InitScriptText');
s = regexprep(s, '%[^\n]*', '');                         % Kommentare entfernen
shape = regexp(s, 'createShape\(\s*Actor\s*,\s*''(\w+)''\s*,\s*(\[[^\]]*\])', 'tokens', 'once');
if isempty(shape), shape = {'box', '[0.05 0.05 0.05]'}; end
color = regexp(s, 'Actor\.Color\s*=\s*([^;\n]+)', 'tokens', 'once');
if isempty(color), color = {'[0.4 0.4 0.4]'}; end
transp = regexp(s, 'Actor\.Transparency\s*=\s*([^;\n]+)', 'tokens', 'once');
if isempty(transp), transp = {'0'}; end
actor = get_param(blk, 'ActorName');
in = strtrim(splitlines(string(get_param(blk, 'InputsText'))));
in = in(in ~= "");
in = regexprep(in, '^.*\.', '');                          % 'actor_cube1.Translation' -> 'Translation'
prm = {'ActorName', actor, 'Shape', shape{1}, 'Size', shape{2}, 'Color', strtrim(color{1}), ...
    'Transparency', strtrim(transp{1}), 'Translation', get_param(blk, 'Translation'), ...
    'Rotation', get_param(blk, 'Rotation'), 'Scale', get_param(blk, 'Scale'), ...
    'Inputs', char(strjoin(in, ','))};
end

function replaceBlock(blk, cls, prm)
% Unreal-Block durch MATLAB-System-Block ersetzen, Eingaenge neu verbinden
parent = get_param(blk, 'Parent');
name = get_param(blk, 'Name');
pos = get_param(blk, 'Position');
esc = @(h) strrep(get_param(h, 'Name'), '/', '//');
ph = get_param(blk, 'PortHandles');
src = zeros(1, numel(ph.Inport));                         % Quellports der Eingaenge
for k = 1:numel(ph.Inport)
    l = get_param(ph.Inport(k), 'Line');
    if l ~= -1
        src(k) = get_param(l, 'SrcPortHandle');
        delete_line(parent, sprintf('%s/%d', esc(get_param(src(k), 'Parent')), get_param(src(k), 'PortNumber')), ...
            sprintf('%s/%d', esc(blk), k));
    end
end
for k = 1:numel(ph.Outport)                               % Ausgaenge (meist Terminatoren) entfernen
    l = get_param(ph.Outport(k), 'Line');
    if l == -1, continue, end
    dst = get_param(l, 'DstBlockHandle');
    delete_line(l);
    for d = dst(:)'
        if strcmp(get_param(d, 'BlockType'), 'Terminator')
            delete_block(d);
        end
    end
end
delete_block(blk);
nb = [parent '/' name];
add_block('simulink/User-Defined Functions/MATLAB System', nb, 'System', cls, 'Position', pos);
set_param(nb, 'SimulateUsing', 'Interpreted execution', prm{:});
nph = get_param(nb, 'PortHandles');
for k = 1:min(numel(src), numel(nph.Inport))
    if src(k) ~= 0
        add_line(parent, src(k), nph.Inport(k), 'autorouting', 'on');
    end
end
end
