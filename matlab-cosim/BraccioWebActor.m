classdef BraccioWebActor < matlab.System
%BRACCIOWEBACTOR Block "Web Actor" - Ersatz fuer Simulation 3D Actor.
%
%   Parameter wie am Block Simulation 3D Actor (Unreal-KS, y gespiegelt):
%     ActorName, Translation [m], Rotation [roll pitch yaw] [rad], Scale,
%     dazu die Angaben aus dessen Init-Skript: Shape ('box' oder 'sphere'),
%     Size [m], Color [r g b], Transparency (0 = deckend, 1 = unsichtbar).
%   Inputs: Liste der Eingaenge in der Reihenfolge der Ports, z. B.
%     'Translation,Rotation,Color,Transparency' (leer = statischer Akteur).
%
%   F. Bender, DHBW Stuttgart

    properties (Nontunable)
        ActorName = 'actor'         % Name wie am Block Simulation 3D Actor
        Shape = 'box'               % Form: 'box' oder 'sphere'
        Size = [0.025 0.025 0.025]  % Abmessungen [m]
        Color = [0.4 0.4 0.4]       % Farbe [r g b]
        Transparency = 0            % 0 = deckend, 1 = unsichtbar
        Translation = [0 0 0]       % Startlage im Unreal-KS [m]
        Rotation = [0 0 0]          % Startdrehung [roll pitch yaw] im Unreal-KS [rad]
        Scale = [1 1 1]             % Skalierung
        Inputs = ''                 % Eingaenge, z. B. 'Translation,Rotation'
    end

    properties (Access = private)
        In = {}                     % Eingangsnamen
    end

    methods
        function obj = BraccioWebActor(varargin)
            setProperties(obj, nargin, varargin{:});
        end
    end

    methods (Access = protected)
        function setupImpl(obj)
            obj.In = obj.inputList();
            [p, r] = BraccioWebHub.fromUnreal(obj.Translation, obj.Rotation);
            def = struct('n', obj.ActorName, 'shape', char(obj.Shape), 'size', double(obj.Size(:)'), ...
                'color', double(obj.Color(:)'), 'alpha', double(obj.Transparency), 'p', p, 'r', r, ...
                's', double(obj.Scale(:)'));
            BraccioWebHub.instance().register(def);
        end

        function stepImpl(obj, varargin)
            if isempty(obj.In)
                return                  % statischer Akteur: nur in der Szene-Nachricht
            end
            p = []; r = []; c = []; a = [];
            for i = 1:numel(obj.In)
                v = double(varargin{i});
                switch obj.In{i}
                    case 'Translation', p = v;
                    case 'Rotation', r = v;
                    case 'Color', c = v(:)';
                    case 'Transparency', a = v(1);
                end
            end
            if ~isempty(p) || ~isempty(r)
                if isempty(p), p = obj.Translation; end
                if isempty(r), r = obj.Rotation; end
                [p, r] = BraccioWebHub.fromUnreal(p, r);
            end
            BraccioWebHub.instance().update(obj.ActorName, p, r, c, a);
        end

        function n = getNumInputsImpl(obj)
            n = numel(obj.inputList());
        end

        function varargout = getInputNamesImpl(obj)
            varargout = obj.inputList();
        end

        function icon = getIconImpl(obj)
            icon = sprintf('Web Actor\n%s', obj.ActorName);
        end
    end

    methods (Access = private)
        function c = inputList(obj)
            c = strtrim(strsplit(char(obj.Inputs), {',', ';', ' '}));
            c = c(~cellfun(@isempty, c));
        end
    end

    methods (Static, Access = protected)
        function header = getHeaderImpl
            header = matlab.system.display.Header('BraccioWebActor', 'Title', 'Web Actor', ...
                'Text', ['Ersatz fuer Simulation 3D Actor: Quader oder Kugel in BraccioSim. Lage im Unreal-KS ' ...
                'wie am Unreal-Block; Eingaenge laut Parameter Inputs.']);
        end
    end
end
